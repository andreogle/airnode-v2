import path from 'node:path';
import { go } from '@api3/promise-utils';
import type { Hex } from 'viem';
import { logger } from './logger';

// =============================================================================
// API call result
// =============================================================================
interface ApiCallResult {
  readonly data: unknown;
  readonly status: number;
}

// =============================================================================
// Hook context types
// =============================================================================
interface HttpRequestContext {
  readonly requestId: Hex;
  readonly endpointId: Hex;
  readonly api: string;
  readonly endpoint: string;
  readonly parameters: Record<string, string>;
  readonly signal: AbortSignal;
}

interface BeforeApiCallContext {
  readonly requestId: Hex;
  readonly endpointId: Hex;
  readonly api: string;
  readonly endpoint: string;
  readonly parameters: Record<string, string>;
  readonly signal: AbortSignal;
}

interface AfterApiCallContext {
  readonly requestId: Hex;
  readonly endpointId: Hex;
  readonly api: string;
  readonly endpoint: string;
  readonly parameters: Record<string, string>;
  readonly response: ApiCallResult;
  readonly signal: AbortSignal;
}

interface BeforeSignContext {
  readonly requestId: Hex;
  readonly endpointId: Hex;
  readonly api: string;
  readonly endpoint: string;
  readonly data: Hex;
  readonly signal: AbortSignal;
}

interface ResponseSentContext {
  readonly requestId: Hex;
  readonly endpointId: Hex;
  readonly api: string;
  readonly endpoint: string;
  readonly duration: number;
  readonly signal: AbortSignal;
}

interface ErrorContext {
  readonly requestId?: Hex;
  readonly error: Error;
  readonly stage: string;
  readonly endpointId?: Hex;
  readonly signal: AbortSignal;
}

// =============================================================================
// Hook return types
// =============================================================================
type HttpRequestResult = { readonly reject: true; readonly status: number; readonly message: string } | undefined;
type BeforeApiCallResult = { readonly parameters: Record<string, string> } | undefined;
type AfterApiCallResult = { readonly data: unknown; readonly status: number } | undefined;
type BeforeSignResult = { readonly data: Hex } | undefined;

// =============================================================================
// Plugin hooks interface
// =============================================================================
interface PluginHooks {
  readonly onHttpRequest?: (context: HttpRequestContext) => HttpRequestResult | Promise<HttpRequestResult>;
  readonly onBeforeApiCall?: (context: BeforeApiCallContext) => BeforeApiCallResult | Promise<BeforeApiCallResult>;
  readonly onAfterApiCall?: (context: AfterApiCallContext) => AfterApiCallResult | Promise<AfterApiCallResult>;
  readonly onBeforeSign?: (context: BeforeSignContext) => BeforeSignResult | Promise<BeforeSignResult>;
  readonly onResponseSent?: (context: ResponseSentContext) => void | Promise<void>;
  readonly onError?: (context: ErrorContext) => void | Promise<void>;
}

interface AirnodePlugin {
  readonly name: string;
  readonly hooks: PluginHooks;
}

// =============================================================================
// Plugin config entry
// =============================================================================
interface PluginConfigEntry {
  readonly source: string;
  readonly timeout: number;
}

// =============================================================================
// Budget tracker
// =============================================================================
interface PluginBudget {
  readonly name: string;
  readonly totalMs: number;
  remainingMs: number;
}

interface LoadedPlugin {
  readonly plugin: AirnodePlugin;
  readonly timeout: number;
}

function createBudgetMap(loaded: readonly LoadedPlugin[]): Map<string, PluginBudget> {
  return new Map(
    loaded.map((e) => [e.plugin.name, { name: e.plugin.name, totalMs: e.timeout, remainingMs: e.timeout }])
  );
}

// =============================================================================
// Timeout-aware hook execution
//
// Races the hook against the plugin's remaining budget. Returns the result or
// a timeout indicator. Deducts elapsed time from the budget.
// =============================================================================
interface BudgetSuccess<T> {
  readonly outcome: 'ok';
  readonly data: T;
}

interface BudgetTimeout {
  readonly outcome: 'timeout';
}

interface BudgetError {
  readonly outcome: 'error';
  readonly error: Error;
}

type BudgetResult<T> = BudgetSuccess<T> | BudgetTimeout | BudgetError;

const TIMEOUT_SENTINEL = Symbol('timeout');

async function runWithBudget<T>(
  budget: PluginBudget,
  fn: (signal: AbortSignal) => Promise<T>
): Promise<BudgetResult<T>> {
  if (budget.remainingMs <= 0) {
    return { outcome: 'timeout' };
  }

  const controller = new AbortController();
  const start = Date.now();

  const timeoutPromise = new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
    setTimeout(() => {
      controller.abort();
      resolve(TIMEOUT_SENTINEL);
    }, budget.remainingMs);
  });

  const result = await go(async () => Promise.race([fn(controller.signal), timeoutPromise]));

  const elapsed = Date.now() - start;
  budget.remainingMs = Math.max(0, budget.remainingMs - elapsed); // eslint-disable-line functional/immutable-data

  if (!result.success) {
    return { outcome: 'error', error: result.error };
  }

  if (result.data === TIMEOUT_SENTINEL) {
    return { outcome: 'timeout' };
  }

  return { outcome: 'ok', data: result.data as T };
}

// =============================================================================
// Plugin registry
//
// `RequestPlugins` is a single request's view of the plugin chain — each hook
// method shares a private budget map that lives for the lifetime of that
// request. `PluginRegistry` is the long-lived holder; call `beginRequest()` at
// the start of every request to mint a fresh `RequestPlugins`. There is
// deliberately no shared "ambient" budget on the registry: under concurrent
// requests, a shared mutable budget would let one request consume another's
// allowance and cause spurious drops.
// =============================================================================
interface RequestPlugins {
  readonly callHttpRequest: (context: Omit<HttpRequestContext, 'signal'>) => Promise<HttpRequestResult>;
  readonly callBeforeApiCall: (
    context: Omit<BeforeApiCallContext, 'signal'>
  ) => Promise<{ readonly parameters: Record<string, string>; readonly dropped: boolean }>;
  readonly callAfterApiCall: (
    context: Omit<AfterApiCallContext, 'signal'>
  ) => Promise<{ readonly response: ApiCallResult; readonly dropped: boolean }>;
  readonly callBeforeSign: (
    context: Omit<BeforeSignContext, 'signal'>
  ) => Promise<{ readonly data: Hex; readonly dropped: boolean }>;
  readonly callResponseSent: (context: Omit<ResponseSentContext, 'signal'>) => Promise<void>;
  readonly callError: (context: Omit<ErrorContext, 'signal'>) => Promise<void>;
}

interface PluginRegistry {
  readonly plugins: readonly AirnodePlugin[];
  readonly hasApiHooks: boolean;
  readonly beginRequest: () => RequestPlugins;
}

const EMPTY_REQUEST_PLUGINS: RequestPlugins = {
  // The `undefined` is the HttpRequestResult "no rejection" value — Promise.resolve() would be Promise<void>.
  // eslint-disable-next-line unicorn/no-useless-undefined
  callHttpRequest: () => Promise.resolve(undefined),
  callBeforeApiCall: (ctx) => Promise.resolve({ parameters: ctx.parameters, dropped: false }),
  callAfterApiCall: (ctx) => Promise.resolve({ response: ctx.response, dropped: false }),
  callBeforeSign: (ctx) => Promise.resolve({ data: ctx.data, dropped: false }),
  callResponseSent: () => Promise.resolve(),
  callError: () => Promise.resolve(),
};

function createEmptyRegistry(): PluginRegistry {
  return {
    plugins: [],
    hasApiHooks: false,
    beginRequest: () => EMPTY_REQUEST_PLUGINS,
  };
}

// =============================================================================
// Hook runners (budget-aware)
// =============================================================================

// Void runner — observation hooks. Timeout = skip with warning.
async function callVoidHook<T>(
  plugins: readonly AirnodePlugin[],
  budgets: Map<string, PluginBudget>,
  getHook: (
    hooks: PluginHooks
  ) => ((context: T & { readonly signal: AbortSignal }) => void | Promise<void>) | undefined,
  context: T,
  index = 0
): Promise<void> {
  const plugin = plugins[index];
  if (!plugin) return;

  const hook = getHook(plugin.hooks);
  if (hook) {
    const budget = budgets.get(plugin.name);
    if (!budget || budget.remainingMs <= 0) {
      if (budget && budget.remainingMs <= 0) {
        logger.warn(`Plugin "${plugin.name}" budget exhausted, skipping hook`);
      }
    } else {
      const result = await runWithBudget(budget, (signal) => Promise.resolve(hook({ ...context, signal })));
      if (result.outcome === 'timeout') {
        logger.warn(`Plugin "${plugin.name}" timed out (budget: ${String(budget.totalMs)}ms)`);
      }
      if (result.outcome === 'error') {
        logger.error(`Plugin "${plugin.name}" failed: ${result.error.message}`);
      }
    }
  }

  await callVoidHook(plugins, budgets, getHook, context, index + 1);
}

// Reject runner for onHttpRequest. First plugin to return { reject: true } stops.
// Mutation hooks are fail-closed: a timeout or a thrown error rejects the
// request rather than letting it slip past a broken security plugin.
async function callHttpRequestHook(
  plugins: readonly AirnodePlugin[],
  budgets: Map<string, PluginBudget>,
  context: Omit<HttpRequestContext, 'signal'>,
  index = 0
): Promise<HttpRequestResult> {
  const plugin = plugins[index];
  if (!plugin) return undefined;

  const hook = plugin.hooks.onHttpRequest;
  if (hook) {
    const budget = budgets.get(plugin.name);
    if (!budget || budget.remainingMs <= 0) {
      if (budget && budget.remainingMs <= 0) {
        logger.warn(`Plugin "${plugin.name}" budget exhausted, rejecting in onHttpRequest`);
        return { reject: true, status: 503, message: 'Plugin budget exhausted' };
      }
      return callHttpRequestHook(plugins, budgets, context, index + 1);
    }

    const result = await runWithBudget(budget, (signal) => Promise.resolve(hook({ ...context, signal })));
    if (result.outcome === 'timeout') {
      logger.warn(`Plugin "${plugin.name}" timed out in onHttpRequest`);
      return { reject: true, status: 503, message: 'Plugin timeout' };
    }
    if (result.outcome === 'error') {
      logger.error(`Plugin "${plugin.name}" failed in onHttpRequest, rejecting: ${result.error.message}`);
      return { reject: true, status: 500, message: 'Plugin error' };
    }

    if (result.data?.reject) {
      return result.data;
    }
  }

  return callHttpRequestHook(plugins, budgets, context, index + 1);
}

// Override runner for onBeforeApiCall. Fail-closed: timeout, error, or
// exhausted budget all drop the affected request(s).
async function callBeforeApiCallHook(
  plugins: readonly AirnodePlugin[],
  budgets: Map<string, PluginBudget>,
  context: Omit<BeforeApiCallContext, 'signal'>,
  index = 0
): Promise<{ readonly parameters: Record<string, string>; readonly dropped: boolean }> {
  const plugin = plugins[index];
  if (!plugin) return { parameters: context.parameters, dropped: false };

  const hook = plugin.hooks.onBeforeApiCall;
  if (hook) {
    const budget = budgets.get(plugin.name);
    if (!budget || budget.remainingMs <= 0) {
      logger.warn(`Plugin "${plugin.name}" budget exhausted in onBeforeApiCall, dropping request(s)`);
      return { parameters: context.parameters, dropped: true };
    }

    const result = await runWithBudget(budget, (signal) => Promise.resolve(hook({ ...context, signal })));
    if (result.outcome === 'timeout') {
      logger.warn(`Plugin "${plugin.name}" timed out in onBeforeApiCall, dropping request(s)`);
      return { parameters: context.parameters, dropped: true };
    }
    if (result.outcome === 'error') {
      logger.error(`Plugin "${plugin.name}" failed in onBeforeApiCall, dropping request(s): ${result.error.message}`);
      return { parameters: context.parameters, dropped: true };
    }

    if (result.data !== undefined) {
      return callBeforeApiCallHook(plugins, budgets, { ...context, parameters: result.data.parameters }, index + 1);
    }
  }

  return callBeforeApiCallHook(plugins, budgets, context, index + 1);
}

// Override runner for onAfterApiCall. Fail-closed: timeout, error, or
// exhausted budget all drop the affected request(s).
async function callAfterApiCallHook(
  plugins: readonly AirnodePlugin[],
  budgets: Map<string, PluginBudget>,
  context: Omit<AfterApiCallContext, 'signal'>,
  index = 0
): Promise<{ readonly response: ApiCallResult; readonly dropped: boolean }> {
  const plugin = plugins[index];
  if (!plugin) return { response: context.response, dropped: false };

  const hook = plugin.hooks.onAfterApiCall;
  if (hook) {
    const budget = budgets.get(plugin.name);
    if (!budget || budget.remainingMs <= 0) {
      logger.warn(`Plugin "${plugin.name}" budget exhausted in onAfterApiCall, dropping request(s)`);
      return { response: context.response, dropped: true };
    }

    const result = await runWithBudget(budget, (signal) => Promise.resolve(hook({ ...context, signal })));
    if (result.outcome === 'timeout') {
      logger.warn(`Plugin "${plugin.name}" timed out in onAfterApiCall, dropping request(s)`);
      return { response: context.response, dropped: true };
    }
    if (result.outcome === 'error') {
      logger.error(`Plugin "${plugin.name}" failed in onAfterApiCall, dropping request(s): ${result.error.message}`);
      return { response: context.response, dropped: true };
    }

    if (result.data !== undefined) {
      return callAfterApiCallHook(
        plugins,
        budgets,
        { ...context, response: { data: result.data.data, status: result.data.status } },
        index + 1
      );
    }
  }

  return callAfterApiCallHook(plugins, budgets, context, index + 1);
}

// Override runner for onBeforeSign. Fail-closed: timeout, error, or exhausted
// budget all drop the request — a plugin that can rewrite signed bytes must
// never be silently skipped.
async function callBeforeSignHook(
  plugins: readonly AirnodePlugin[],
  budgets: Map<string, PluginBudget>,
  context: Omit<BeforeSignContext, 'signal'>,
  index = 0
): Promise<{ readonly data: Hex; readonly dropped: boolean }> {
  const plugin = plugins[index];
  if (!plugin) return { data: context.data, dropped: false };

  const hook = plugin.hooks.onBeforeSign;
  if (hook) {
    const budget = budgets.get(plugin.name);
    if (!budget || budget.remainingMs <= 0) {
      logger.warn(`Plugin "${plugin.name}" budget exhausted in onBeforeSign, dropping request(s)`);
      return { data: context.data, dropped: true };
    }

    const result = await runWithBudget(budget, (signal) => Promise.resolve(hook({ ...context, signal })));
    if (result.outcome === 'timeout') {
      logger.warn(`Plugin "${plugin.name}" timed out in onBeforeSign, dropping request(s)`);
      return { data: context.data, dropped: true };
    }
    if (result.outcome === 'error') {
      logger.error(`Plugin "${plugin.name}" failed in onBeforeSign, dropping request(s): ${result.error.message}`);
      return { data: context.data, dropped: true };
    }

    if (result.data !== undefined) {
      return callBeforeSignHook(plugins, budgets, { ...context, data: result.data.data }, index + 1);
    }
  }

  return callBeforeSignHook(plugins, budgets, context, index + 1);
}

// =============================================================================
// Registry factory
// =============================================================================
function createRegistry(loaded: readonly LoadedPlugin[]): PluginRegistry {
  const plugins = loaded.map((l) => l.plugin);
  const hasApiHooks = plugins.some((p) => p.hooks.onBeforeApiCall || p.hooks.onAfterApiCall || p.hooks.onBeforeSign);

  return {
    plugins,
    hasApiHooks,
    beginRequest: () => {
      // Per-request budget map — never shared with other in-flight requests.
      const budgets = createBudgetMap(loaded);
      return {
        callHttpRequest: (ctx) => callHttpRequestHook(plugins, budgets, ctx),
        callBeforeApiCall: (ctx) => callBeforeApiCallHook(plugins, budgets, ctx),
        callAfterApiCall: (ctx) => callAfterApiCallHook(plugins, budgets, ctx),
        callBeforeSign: (ctx) => callBeforeSignHook(plugins, budgets, ctx),
        callResponseSent: (ctx) => callVoidHook(plugins, budgets, (h) => h.onResponseSent, ctx),
        callError: (ctx) => callVoidHook(plugins, budgets, (h) => h.onError, ctx),
      };
    },
  };
}

// =============================================================================
// Plugin loader
// =============================================================================
async function importPlugin(pluginPath: string): Promise<AirnodePlugin> {
  const resolved = path.resolve(pluginPath);
  const mod = (await import(resolved)) as { default?: AirnodePlugin };

  if (!mod.default) {
    throw new Error(`Plugin at ${resolved} has no default export`);
  }

  if (typeof mod.default.name !== 'string' || typeof mod.default.hooks !== 'object') {
    throw new TypeError(`Plugin at ${resolved} is missing required "name" or "hooks" fields`);
  }

  return mod.default;
}

// =============================================================================
// Load plugins from config entries
//
// Each entry specifies a source (file path) and timeout budget. The plugin's
// exported name is used for logging and budget tracking.
// =============================================================================
async function loadPlugins(configEntries: readonly PluginConfigEntry[], configDir: string): Promise<PluginRegistry> {
  if (configEntries.length === 0) return createEmptyRegistry();

  const loaded: LoadedPlugin[] = [];

  // eslint-disable-next-line functional/no-loop-statements
  for (const entry of configEntries) {
    const resolvedSource = path.resolve(configDir, entry.source);
    const result = await go(() => importPlugin(resolvedSource));
    if (!result.success) {
      logger.error(`Failed to load plugin "${entry.source}": ${result.error.message}`);
      continue;
    }
    logger.info(`Plugin loaded: ${result.data.name} (budget: ${String(entry.timeout)}ms)`);
    loaded.push({ plugin: result.data, timeout: entry.timeout }); // eslint-disable-line functional/immutable-data
  }

  const registry = createRegistry(loaded);

  if (registry.hasApiHooks) {
    logger.warn('Plugins with API/sign hooks detected — inline execution enabled for hook interception');
  }

  // Surface plugins that can rewrite signed payload bytes. These plugins can
  // cause the airnode to sign arbitrary data of their choosing and should be
  // audited as carefully as the signing key itself.
  const signMutators = loaded.filter((l) => l.plugin.hooks.onBeforeSign).map((l) => l.plugin.name);
  if (signMutators.length > 0) {
    logger.warn(
      `SECURITY: ${String(signMutators.length)} plugin(s) can substitute bytes before signing. ` +
        `These plugins effectively share signing-key authority — audit them like you would the private key:`
    );
    // eslint-disable-next-line functional/no-loop-statements
    for (const name of signMutators) {
      logger.warn(`  - ${name} (onBeforeSign)`);
    }
  }

  return registry;
}

export { createEmptyRegistry, createRegistry, loadPlugins };
export type {
  AfterApiCallContext,
  AfterApiCallResult,
  AirnodePlugin,
  ApiCallResult,
  BeforeApiCallContext,
  BeforeApiCallResult,
  BeforeSignContext,
  BeforeSignResult,
  ErrorContext,
  HttpRequestContext,
  HttpRequestResult,
  LoadedPlugin,
  PluginConfigEntry,
  PluginHooks,
  PluginRegistry,
  RequestPlugins,
  ResponseSentContext,
};
