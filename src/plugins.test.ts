import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Hex } from 'viem';
import { configureLogger } from './logger';
import { createRegistry, loadPlugins, type AirnodePlugin, type BeforeApiCallContext } from './plugins';

const infoMock = mock();
const errorMock = mock();
const warnMock = mock();

beforeEach(() => {
  configureLogger('text');
  console.info = infoMock;
  console.error = errorMock;
  console.warn = warnMock;
});

afterEach(() => {
  infoMock.mockClear();
  errorMock.mockClear();
  warnMock.mockClear();
});

function makeLoaded(
  plugins: readonly AirnodePlugin[],
  timeout = 5000
): readonly { plugin: AirnodePlugin; timeout: number }[] {
  return plugins.map((plugin) => ({ plugin, timeout }));
}

const ENDPOINT_ID: Hex = `0x${'aa'.repeat(32)}`;

// =============================================================================
// Empty registry — `createRegistry([])` is the canonical no-plugin state
// =============================================================================
describe('createRegistry([]) — empty', () => {
  test('has no plugins', () => {
    const registry = createRegistry([]);
    expect(registry.plugins).toHaveLength(0);
  });

  test('callHttpRequest returns undefined', async () => {
    const result = await createRegistry([])
      .beginRequest()
      .callHttpRequest({
        requestId: ENDPOINT_ID,
        endpointId: ENDPOINT_ID,
        api: 'coingecko',
        endpoint: 'price',
        parameters: { coinId: 'bitcoin' },
      });
    expect(result).toBeUndefined();
  });

  test('callBeforeApiCall passes through parameters', async () => {
    const result = await createRegistry([])
      .beginRequest()
      .callBeforeApiCall({
        requestId: ENDPOINT_ID,
        endpointId: ENDPOINT_ID,
        api: 'coingecko',
        endpoint: 'price',
        parameters: { coinId: 'bitcoin' },
      });
    expect(result).toEqual({ parameters: { coinId: 'bitcoin' }, dropped: false });
  });

  test('callAfterApiCall passes through response', async () => {
    const response = { data: { price: 100 }, status: 200 };
    const result = await createRegistry([]).beginRequest().callAfterApiCall({
      requestId: ENDPOINT_ID,
      endpointId: ENDPOINT_ID,
      api: 'coingecko',
      endpoint: 'price',
      parameters: {},
      response,
    });
    expect(result).toEqual({ response, dropped: false });
  });

  test('callBeforeSign passes through data', async () => {
    const result = await createRegistry([]).beginRequest().callBeforeSign({
      requestId: ENDPOINT_ID,
      endpointId: ENDPOINT_ID,
      api: 'coingecko',
      endpoint: 'price',
      data: '0xaabb',
    });
    expect(result).toEqual({ data: '0xaabb', dropped: false });
  });
});

// =============================================================================
// createRegistry — void hooks
// =============================================================================
describe('createRegistry', () => {
  test('calls onResponseSent for all plugins', async () => {
    const sentMock1 = mock();
    const sentMock2 = mock();
    const plugins: AirnodePlugin[] = [
      { name: 'p1', hooks: { onResponseSent: sentMock1 } },
      { name: 'p2', hooks: { onResponseSent: sentMock2 } },
    ];
    const registry = createRegistry(makeLoaded(plugins));

    await registry.beginRequest().callResponseSent({
      requestId: ENDPOINT_ID,
      endpointId: ENDPOINT_ID,
      api: 'coingecko',
      endpoint: 'price',
      duration: 250,
    });

    expect(sentMock1).toHaveBeenCalledTimes(1);
    expect(sentMock2).toHaveBeenCalledTimes(1);
  });

  test('skips plugins without the hook', async () => {
    const sentMock = mock();
    const plugins: AirnodePlugin[] = [
      { name: 'no-hooks', hooks: {} },
      { name: 'has-sent', hooks: { onResponseSent: sentMock } },
    ];
    const registry = createRegistry(makeLoaded(plugins));

    await registry.beginRequest().callResponseSent({
      requestId: ENDPOINT_ID,
      endpointId: ENDPOINT_ID,
      api: 'coingecko',
      endpoint: 'price',
      duration: 100,
    });

    expect(sentMock).toHaveBeenCalledTimes(1);
  });

  test('catches and logs plugin errors without throwing', async () => {
    const failingPlugin: AirnodePlugin = {
      name: 'crasher',
      hooks: {
        onResponseSent: () => {
          throw new Error('plugin boom');
        },
      },
    };
    const afterPlugin = mock();
    const plugins: AirnodePlugin[] = [failingPlugin, { name: 'after', hooks: { onResponseSent: afterPlugin } }];
    const registry = createRegistry(makeLoaded(plugins));

    await registry.beginRequest().callResponseSent({
      requestId: ENDPOINT_ID,
      endpointId: ENDPOINT_ID,
      api: 'coingecko',
      endpoint: 'price',
      duration: 100,
    });

    const errorOutput = String(errorMock.mock.calls[0]?.[0]);
    expect(errorOutput).toContain('crasher');
    expect(errorOutput).toContain('plugin boom');
    expect(afterPlugin).toHaveBeenCalledTimes(1);
  });

  test('catches async plugin errors', async () => {
    const plugins: AirnodePlugin[] = [
      {
        name: 'async-crasher',
        hooks: { onResponseSent: () => Promise.reject(new Error('async boom')) },
      },
    ];
    const registry = createRegistry(makeLoaded(plugins));

    await registry.beginRequest().callResponseSent({
      requestId: ENDPOINT_ID,
      endpointId: ENDPOINT_ID,
      api: 'coingecko',
      endpoint: 'price',
      duration: 100,
    });

    const errorOutput = String(errorMock.mock.calls[0]?.[0]);
    expect(errorOutput).toContain('async-crasher');
    expect(errorOutput).toContain('async boom');
  });

  test('runs plugins in registration order', async () => {
    const order: number[] = [];
    const plugins: AirnodePlugin[] = [
      {
        name: 'first',
        hooks: {
          onResponseSent: () => {
            order.push(1);
          },
        },
      },
      {
        name: 'second',
        hooks: {
          onResponseSent: () => {
            order.push(2);
          },
        },
      },
      {
        name: 'third',
        hooks: {
          onResponseSent: () => {
            order.push(3);
          },
        },
      },
    ];
    const registry = createRegistry(makeLoaded(plugins));

    await registry.beginRequest().callResponseSent({
      requestId: ENDPOINT_ID,
      endpointId: ENDPOINT_ID,
      api: 'coingecko',
      endpoint: 'price',
      duration: 100,
    });

    expect(order).toEqual([1, 2, 3]);
  });
});

// =============================================================================
// onHttpRequest — reject runner
// =============================================================================
describe('callHttpRequest', () => {
  const baseCtx = {
    requestId: ENDPOINT_ID,
    endpointId: ENDPOINT_ID,
    api: 'coingecko',
    endpoint: 'price',
    parameters: { coinId: 'bitcoin' },
  };

  test('returns undefined when no plugins reject', async () => {
    const plugins: AirnodePlugin[] = [{ name: 'empty', hooks: {} }];
    const registry = createRegistry(makeLoaded(plugins));
    const result = await registry.beginRequest().callHttpRequest(baseCtx);
    expect(result).toBeUndefined();
  });

  test('plugin can reject request', async () => {
    const plugins: AirnodePlugin[] = [
      {
        name: 'blocker',
        hooks: {
          onHttpRequest: () => ({ reject: true as const, status: 403, message: 'Forbidden' }),
        },
      },
    ];
    const registry = createRegistry(makeLoaded(plugins));
    const result = await registry.beginRequest().callHttpRequest(baseCtx);
    expect(result).toEqual({ reject: true, status: 403, message: 'Forbidden' });
  });

  test('undefined return means no rejection', async () => {
    const plugins: AirnodePlugin[] = [{ name: 'pass', hooks: { onHttpRequest: () => {} } }];
    const registry = createRegistry(makeLoaded(plugins));
    const result = await registry.beginRequest().callHttpRequest(baseCtx);
    expect(result).toBeUndefined();
  });

  test('rejects when a plugin throws (fail-closed)', async () => {
    const plugins: AirnodePlugin[] = [
      {
        name: 'crasher',
        hooks: {
          onHttpRequest: () => {
            throw new Error('boom');
          },
        },
      },
      { name: 'pass', hooks: {} },
    ];
    const registry = createRegistry(makeLoaded(plugins));
    const result = await registry.beginRequest().callHttpRequest(baseCtx);
    expect(result).toEqual({ reject: true, status: 500, message: 'Plugin error' });
  });

  test('rejects when a plugin budget is exhausted (fail-closed)', async () => {
    const plugins: AirnodePlugin[] = [{ name: 'starved', hooks: { onHttpRequest: () => {} } }];
    const registry = createRegistry([{ plugin: plugins[0] as AirnodePlugin, timeout: 0 }]);
    const result = await registry.beginRequest().callHttpRequest(baseCtx);
    expect(result).toEqual({ reject: true, status: 503, message: 'Plugin budget exhausted' });
  });
});

// =============================================================================
// Override runner — onBeforeApiCall
// =============================================================================
describe('callBeforeApiCall', () => {
  const baseCtx = {
    requestId: ENDPOINT_ID,
    endpointId: ENDPOINT_ID,
    api: 'coingecko',
    endpoint: 'price',
    parameters: { coinId: 'bitcoin' },
  };

  test('returns original parameters when no plugins override', async () => {
    const plugins: AirnodePlugin[] = [{ name: 'empty', hooks: {} }];
    const registry = createRegistry(makeLoaded(plugins));
    const result = await registry.beginRequest().callBeforeApiCall(baseCtx);
    expect(result).toEqual({ parameters: { coinId: 'bitcoin' }, dropped: false });
  });

  test('plugin can override parameters', async () => {
    const plugins: AirnodePlugin[] = [
      { name: 'override', hooks: { onBeforeApiCall: () => ({ parameters: { coinId: 'ethereum' } }) } },
    ];
    const registry = createRegistry(makeLoaded(plugins));

    const result = await registry.beginRequest().callBeforeApiCall(baseCtx);
    expect(result).toEqual({ parameters: { coinId: 'ethereum' }, dropped: false });
  });

  test('chains overrides — second plugin sees output of first', async () => {
    const plugins: AirnodePlugin[] = [
      { name: 'first', hooks: { onBeforeApiCall: () => ({ parameters: { coinId: 'ethereum' } }) } },
      {
        name: 'second',
        hooks: {
          onBeforeApiCall: (ctx: BeforeApiCallContext) => ({ parameters: { ...ctx.parameters, currency: 'eur' } }),
        },
      },
    ];
    const registry = createRegistry(makeLoaded(plugins));

    const result = await registry.beginRequest().callBeforeApiCall(baseCtx);
    expect(result).toEqual({ parameters: { coinId: 'ethereum', currency: 'eur' }, dropped: false });
  });

  test('undefined return means no change', async () => {
    const plugins: AirnodePlugin[] = [{ name: 'pass', hooks: { onBeforeApiCall: () => {} } }];
    const registry = createRegistry(makeLoaded(plugins));

    const result = await registry.beginRequest().callBeforeApiCall(baseCtx);
    expect(result).toEqual({ parameters: { coinId: 'bitcoin' }, dropped: false });
  });

  test('drops when a plugin throws (fail-closed) — later plugins do not run', async () => {
    const laterPlugin = mock(() => ({ parameters: { coinId: 'ethereum' } }));
    const plugins: AirnodePlugin[] = [
      {
        name: 'crasher',
        hooks: {
          onBeforeApiCall: () => {
            throw new Error('boom');
          },
        },
      },
      { name: 'override', hooks: { onBeforeApiCall: laterPlugin } },
    ];
    const registry = createRegistry(makeLoaded(plugins));

    const result = await registry.beginRequest().callBeforeApiCall(baseCtx);
    expect(result).toEqual({ parameters: { coinId: 'bitcoin' }, dropped: true });
    expect(laterPlugin).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Override runner — onAfterApiCall
// =============================================================================
describe('callAfterApiCall', () => {
  test('plugin can override response', async () => {
    const plugins: AirnodePlugin[] = [
      { name: 'override', hooks: { onAfterApiCall: () => ({ data: { price: 999 }, status: 200 }) } },
    ];
    const registry = createRegistry(makeLoaded(plugins));

    const result = await registry.beginRequest().callAfterApiCall({
      requestId: ENDPOINT_ID,
      endpointId: ENDPOINT_ID,
      api: 'coingecko',
      endpoint: 'price',
      parameters: {},
      response: { data: { price: 100 }, status: 200 },
    });

    expect(result).toEqual({ response: { data: { price: 999 }, status: 200 }, dropped: false });
  });

  test('passes through on undefined', async () => {
    const plugins: AirnodePlugin[] = [{ name: 'pass', hooks: { onAfterApiCall: () => {} } }];
    const registry = createRegistry(makeLoaded(plugins));

    const original = { data: { price: 100 }, status: 200 };
    const result = await registry.beginRequest().callAfterApiCall({
      requestId: ENDPOINT_ID,
      endpointId: ENDPOINT_ID,
      api: 'coingecko',
      endpoint: 'price',
      parameters: {},
      response: original,
    });

    expect(result).toEqual({ response: original, dropped: false });
  });

  test('drops when a plugin throws (fail-closed)', async () => {
    const plugins: AirnodePlugin[] = [
      {
        name: 'crasher',
        hooks: {
          onAfterApiCall: () => {
            throw new Error('boom');
          },
        },
      },
    ];
    const registry = createRegistry(makeLoaded(plugins));

    const original = { data: { price: 100 }, status: 200 };
    const result = await registry.beginRequest().callAfterApiCall({
      requestId: ENDPOINT_ID,
      endpointId: ENDPOINT_ID,
      api: 'coingecko',
      endpoint: 'price',
      parameters: {},
      response: original,
    });

    expect(result).toEqual({ response: original, dropped: true });
  });
});

// =============================================================================
// Override runner — onBeforeSign
// =============================================================================
describe('callBeforeSign', () => {
  const baseCtx = {
    requestId: ENDPOINT_ID,
    endpointId: ENDPOINT_ID,
    api: 'coingecko',
    endpoint: 'price',
    data: '0xaabb' as Hex,
  };

  test('returns original data when no plugins override', async () => {
    const plugins: AirnodePlugin[] = [{ name: 'empty', hooks: {} }];
    const registry = createRegistry(makeLoaded(plugins));
    const result = await registry.beginRequest().callBeforeSign(baseCtx);
    expect(result).toEqual({ data: '0xaabb', dropped: false });
  });

  test('plugin can override data', async () => {
    const plugins: AirnodePlugin[] = [{ name: 'override', hooks: { onBeforeSign: () => ({ data: '0xccdd' }) } }];
    const registry = createRegistry(makeLoaded(plugins));
    const result = await registry.beginRequest().callBeforeSign(baseCtx);
    expect(result.dropped).toBe(false);
    expect(result.data).toBe('0xccdd');
  });

  test('undefined return means no change', async () => {
    const plugins: AirnodePlugin[] = [{ name: 'pass', hooks: { onBeforeSign: () => {} } }];
    const registry = createRegistry(makeLoaded(plugins));
    const result = await registry.beginRequest().callBeforeSign(baseCtx);
    expect(result).toEqual({ data: '0xaabb', dropped: false });
  });

  test('drops when a plugin throws (fail-closed) — original data is kept', async () => {
    const plugins: AirnodePlugin[] = [
      {
        name: 'crasher',
        hooks: {
          onBeforeSign: () => {
            throw new Error('boom');
          },
        },
      },
    ];
    const registry = createRegistry(makeLoaded(plugins));
    const result = await registry.beginRequest().callBeforeSign(baseCtx);
    expect(result).toEqual({ data: '0xaabb', dropped: true });
  });
});

// =============================================================================
// Void hooks — onError
// =============================================================================
describe('void hooks', () => {
  test('callError calls plugins', async () => {
    const hookMock = mock();
    const plugins: AirnodePlugin[] = [{ name: 'observer', hooks: { onError: hookMock } }];
    const registry = createRegistry(makeLoaded(plugins));

    const err = new Error('test error');
    await registry.beginRequest().callError({ error: err, stage: 'apiCall', endpointId: ENDPOINT_ID });

    expect(hookMock).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// Budget and timeout
// =============================================================================
describe('budget', () => {
  test('observation hook is skipped when budget exhausted', async () => {
    const hookMock = mock();
    const plugin: AirnodePlugin = { name: 'slow', hooks: { onResponseSent: hookMock } };
    const registry = createRegistry([{ plugin, timeout: 0 }]);

    await registry.beginRequest().callResponseSent({
      requestId: ENDPOINT_ID,
      endpointId: ENDPOINT_ID,
      api: 'test',
      endpoint: 'test',
      duration: 100,
    });

    expect(hookMock).not.toHaveBeenCalled();
    const warnOutput = String(warnMock.mock.calls[0]?.[0]);
    expect(warnOutput).toContain('budget exhausted');
  });

  test('mutation hook drops when budget exhausted', async () => {
    const plugin: AirnodePlugin = { name: 'slow', hooks: { onBeforeApiCall: () => {} } };
    const registry = createRegistry([{ plugin, timeout: 0 }]);

    const result = await registry.beginRequest().callBeforeApiCall({
      requestId: ENDPOINT_ID,
      endpointId: ENDPOINT_ID,
      api: 'test',
      endpoint: 'test',
      parameters: {},
    });
    expect(result.dropped).toBe(true);
  });

  test('onBeforeSign drops when budget exhausted', async () => {
    const plugin: AirnodePlugin = { name: 'slow', hooks: { onBeforeSign: () => {} } };
    const registry = createRegistry([{ plugin, timeout: 0 }]);

    const result = await registry.beginRequest().callBeforeSign({
      requestId: ENDPOINT_ID,
      endpointId: ENDPOINT_ID,
      api: 'test',
      endpoint: 'test',
      data: '0xaa',
    });
    expect(result.dropped).toBe(true);
  });

  test('beginRequest mints an independent session each time', async () => {
    const hookMock = mock();
    const plugin: AirnodePlugin = { name: 'observer', hooks: { onResponseSent: hookMock } };
    const registry = createRegistry([{ plugin, timeout: 5000 }]);

    const sessionA = registry.beginRequest();
    const sessionB = registry.beginRequest();
    expect(sessionA).not.toBe(sessionB);

    const ctx = { requestId: ENDPOINT_ID, endpointId: ENDPOINT_ID, api: 'test', endpoint: 'test', duration: 1 };
    await sessionA.callResponseSent(ctx);
    await sessionB.callResponseSent(ctx);
    // Each session ran the hook on its own fresh budget — no cross-session interference.
    expect(hookMock).toHaveBeenCalledTimes(2);
  });

  test('hook receives AbortSignal in context', async () => {
    const receivedSignal = mock();
    const plugin: AirnodePlugin = {
      name: 'signal-check',
      hooks: {
        onResponseSent: (ctx) => {
          receivedSignal(ctx.signal instanceof AbortSignal);
        },
      },
    };
    const registry = createRegistry(makeLoaded([plugin]));

    await registry.beginRequest().callResponseSent({
      requestId: ENDPOINT_ID,
      endpointId: ENDPOINT_ID,
      api: 'test',
      endpoint: 'test',
      duration: 100,
    });

    expect(receivedSignal).toHaveBeenCalledWith(true);
  });

  test('mutation hook timeout drops requests and aborts signal', async () => {
    const plugin: AirnodePlugin = {
      name: 'slow',
      hooks: {
        onBeforeApiCall: (ctx: BeforeApiCallContext) =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({ parameters: ctx.parameters });
            }, 500);
          }),
      },
    };
    const registry = createRegistry([{ plugin, timeout: 50 }]);

    const result = await registry.beginRequest().callBeforeApiCall({
      requestId: ENDPOINT_ID,
      endpointId: ENDPOINT_ID,
      api: 'test',
      endpoint: 'test',
      parameters: { coinId: 'bitcoin' },
    });

    expect(result.dropped).toBe(true);
  });

  test('observation hook timeout skips but does not drop', async () => {
    const plugin: AirnodePlugin = {
      name: 'slow',
      hooks: {
        onResponseSent: () =>
          new Promise((resolve) => {
            setTimeout(resolve, 500);
          }),
      },
    };
    const registry = createRegistry([{ plugin, timeout: 50 }]);

    await registry.beginRequest().callResponseSent({
      requestId: ENDPOINT_ID,
      endpointId: ENDPOINT_ID,
      api: 'test',
      endpoint: 'test',
      duration: 100,
    });

    const warnOutput = String(warnMock.mock.calls[0]?.[0]);
    expect(warnOutput).toContain('timed out');
  });

  test('onHttpRequest timeout returns reject', async () => {
    const plugin: AirnodePlugin = {
      name: 'slow',
      hooks: {
        onHttpRequest: () =>
          new Promise((resolve) => {
            setTimeout(resolve, 500);
          }),
      },
    };
    const registry = createRegistry([{ plugin, timeout: 50 }]);

    const result = await registry.beginRequest().callHttpRequest({
      requestId: ENDPOINT_ID,
      endpointId: ENDPOINT_ID,
      api: 'test',
      endpoint: 'test',
      parameters: {},
    });

    expect(result).toEqual({ reject: true, status: 503, message: 'Plugin timeout' });
  });
});

// =============================================================================
// loadPlugins
// =============================================================================
describe('loadPlugins', () => {
  const projectRoot = `${import.meta.dirname}/..`;

  test('returns empty registry when config has no plugins', async () => {
    const registry = await loadPlugins([], projectRoot);
    expect(registry.plugins).toHaveLength(0);
  });

  test('logs error for non-existent plugin file', async () => {
    const registry = await loadPlugins([{ source: '/nonexistent/ghost.ts', timeout: 5000, config: {} }], projectRoot);
    expect(registry.plugins).toHaveLength(0);

    const errorOutput = String(errorMock.mock.calls[0]?.[0]);
    expect(errorOutput).toContain('Failed to load');
  });

  test('loads a valid plugin file by absolute source path', async () => {
    const heartbeatPath = `${projectRoot}/examples/plugins/heartbeat.ts`;
    const registry = await loadPlugins([{ source: heartbeatPath, timeout: 5000, config: {} }], projectRoot);

    expect(registry.plugins).toHaveLength(1);
    expect(registry.plugins[0]?.name).toBe('heartbeat');
  });

  test('resolves relative source paths against configDir', async () => {
    const registry = await loadPlugins(
      [{ source: './examples/plugins/logger.ts', timeout: 5000, config: {} }],
      projectRoot
    );

    expect(registry.plugins).toHaveLength(1);
    expect(registry.plugins[0]?.name).toBe('logger');
  });

  test('loads multiple plugins in order', async () => {
    const registry = await loadPlugins(
      [
        { source: './examples/plugins/heartbeat.ts', timeout: 3000, config: {} },
        { source: './examples/plugins/logger.ts', timeout: 7000, config: {} },
      ],
      projectRoot
    );

    expect(registry.plugins).toHaveLength(2);
    expect(registry.plugins[0]?.name).toBe('heartbeat');
    expect(registry.plugins[1]?.name).toBe('logger');
  });
});

// =============================================================================
// loadPlugins — scoped config + startup validation
// =============================================================================
describe('loadPlugins — config', () => {
  const projectRoot = `${import.meta.dirname}/..`;
  const slackPath = `${projectRoot}/examples/plugins/slack-alerts.ts`;
  const heartbeatPath = `${projectRoot}/examples/plugins/heartbeat.ts`;
  const loggerPath = `${projectRoot}/examples/plugins/logger.ts`;

  // Standalone fixture plugins (no imports, so Bun can run them from a temp dir).
  const fixtureDir = path.join(tmpdir(), `airnode-plugin-fixtures-${String(process.pid)}`);
  const nameFromConfigPath = path.join(fixtureDir, 'name-from-config.ts');
  const throwingFactoryPath = path.join(fixtureDir, 'throwing-factory.ts');

  beforeAll(async () => {
    await mkdir(fixtureDir, { recursive: true });
    await Bun.write(
      nameFromConfigPath,
      'export default (config) => ({ name: `cfg-${String(config.tag)}`, hooks: {} });\n'
    );
    await Bun.write(throwingFactoryPath, 'export default () => { throw new Error("factory boom"); };\n');
  });

  afterAll(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
  });

  test('validates config against the plugin configSchema and loads on success', async () => {
    const registry = await loadPlugins(
      [{ source: slackPath, timeout: 5000, config: { webhookUrl: 'https://hooks.slack.com/services/x/y/z' } }],
      projectRoot
    );
    expect(registry.plugins).toHaveLength(1);
    expect(registry.plugins[0]?.name).toBe('slack-alerts');
  });

  test('rejects a plugin whose config is missing a required field', async () => {
    const registry = await loadPlugins([{ source: slackPath, timeout: 5000, config: {} }], projectRoot);
    expect(registry.plugins).toHaveLength(0);
    expect(String(errorMock.mock.calls[0]?.[0])).toContain('config is invalid');
  });

  test('rejects a plugin whose config value has the wrong shape', async () => {
    const registry = await loadPlugins(
      [{ source: heartbeatPath, timeout: 5000, config: { url: 'not a url' } }],
      projectRoot
    );
    expect(registry.plugins).toHaveLength(0);
    expect(String(errorMock.mock.calls[0]?.[0])).toContain('config is invalid');
  });

  test('passes the validated config to a factory default export', async () => {
    const registry = await loadPlugins(
      [{ source: nameFromConfigPath, timeout: 5000, config: { tag: 'xyz' } }],
      projectRoot
    );
    expect(registry.plugins).toHaveLength(1);
    expect(registry.plugins[0]?.name).toBe('cfg-xyz');
  });

  test('warns and ignores config given to a plain (non-factory) plugin', async () => {
    const registry = await loadPlugins([{ source: loggerPath, timeout: 5000, config: { unused: true } }], projectRoot);
    expect(registry.plugins).toHaveLength(1);
    expect(registry.plugins[0]?.name).toBe('logger');
    const warnings = warnMock.mock.calls.map((c) => String(c[0])).join(' ');
    expect(warnings).toContain('config ignored');
  });

  test('skips a plugin whose factory throws while constructing', async () => {
    const registry = await loadPlugins([{ source: throwingFactoryPath, timeout: 5000, config: {} }], projectRoot);
    expect(registry.plugins).toHaveLength(0);
    expect(String(errorMock.mock.calls[0]?.[0])).toContain('factory threw');
  });
});
