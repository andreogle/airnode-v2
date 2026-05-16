import path from 'node:path';
import { go, goSync } from '@api3/promise-utils';
import type { Hex } from 'viem';
import { logger } from './logger';
import type { PluginConfigEntry } from './types';

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

// A plugin module's default export is either a ready `AirnodePlugin` (no config
// needed) or a factory that takes the validated config and returns one.
type PluginFactory = (config: Record<string, unknown>) => AirnodePlugin;

// Optional named export `configSchema`. Kept structural (anything with a
// throwing `parse`) so plugins can use Zod, Valibot, or a hand-rolled check.
interface PluginConfigSchema {
  readonly parse: (value: unknown) => unknown;
}

interface PluginModule {
  readonly default?: AirnodePlugin | PluginFactory;
  readonly configSchema?: PluginConfigSchema;
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
  readonly beginRequest: () => RequestPlugins;
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

  return {
    plugins,
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
//
// For each entry: import the module → validate the supplied `config` against the
// plugin's exported `configSchema` (if any) → instantiate (a factory default
// export receives the validated config; a plain object is used as-is). Any
// failure logs a clear error and skips that plugin rather than aborting startup.
// =============================================================================
async function loadPluginEntry(entry: PluginConfigEntry, configDir: string): Promise<LoadedPlugin | undefined> {
  const resolved = path.isAbsolute(entry.source) ? entry.source : path.resolve(configDir, entry.source);

  const imported = await go(async () => (await import(resolved)) as PluginModule);
  if (!imported.success) {
    logger.error(`Failed to load plugin "${entry.source}": ${imported.error.message}`);
    return undefined;
  }
  const mod = imported.data;

  const suppliedConfig = entry.config;
  const schema = mod.configSchema;
  const parsed = schema
    ? goSync(() => schema.parse(suppliedConfig))
    : { success: true as const, data: suppliedConfig as unknown };
  if (!parsed.success) {
    logger.error(`Plugin "${entry.source}" config is invalid: ${parsed.error.message}`);
    return undefined;
  }
  const config = (parsed.data ?? {}) as Record<string, unknown>;

  const def = mod.default;
  if (!def) {
    logger.error(`Plugin "${entry.source}" has no default export`);
    return undefined;
  }
  const built = typeof def === 'function' ? goSync(() => def(config)) : goSync(() => def);
  if (!built.success) {
    logger.error(`Plugin "${entry.source}" factory threw while constructing: ${built.error.message}`);
    return undefined;
  }
  const plugin = built.data;

  if (typeof plugin.name !== 'string' || typeof plugin.hooks !== 'object') {
    logger.error(`Plugin "${entry.source}" is missing required "name" or "hooks" fields`);
    return undefined;
  }
  if (typeof def !== 'function' && Object.keys(suppliedConfig).length > 0) {
    logger.warn(`Plugin "${entry.source}" was given config but its default export is not a factory — config ignored`);
  }

  logger.info(`Plugin loaded: ${plugin.name} (budget: ${String(entry.timeout)}ms)`);
  return { plugin, timeout: entry.timeout };
}

// =============================================================================
// Load plugins from config entries
// =============================================================================
async function loadPlugins(configEntries: readonly PluginConfigEntry[], configDir: string): Promise<PluginRegistry> {
  if (configEntries.length === 0) return createRegistry([]);

  const loaded: LoadedPlugin[] = [];

  // eslint-disable-next-line functional/no-loop-statements
  for (const entry of configEntries) {
    const result = await loadPluginEntry(entry, configDir);
    if (result) loaded.push(result); // eslint-disable-line functional/immutable-data
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

  return createRegistry(loaded);
}

export { createRegistry, loadPlugins };
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
  PluginHooks,
  PluginRegistry,
  RequestPlugins,
  ResponseSentContext,
};
