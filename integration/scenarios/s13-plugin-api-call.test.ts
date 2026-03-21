import { afterAll, describe, expect, test } from 'bun:test';
import { createRegistry } from '../../src/plugins';
import type { AirnodePlugin } from '../../src/plugins';
import { createTestServer, findEndpointId, getMockCalls, post, resetMock } from '../helpers';
import type { TestContext } from '../helpers';

let ctx: TestContext;

describe('S13 — Plugin hooks — onBeforeApiCall / onAfterApiCall', () => {
  afterAll(() => {
    ctx.stop();
  });

  test('onBeforeApiCall can modify parameters', async () => {
    const paramOverridePlugin: AirnodePlugin = {
      name: 'param-override',
      hooks: {
        onBeforeApiCall: (context) => ({ parameters: { ...context.parameters, q: 'Tokyo' } }),
      },
    };
    const plugins = createRegistry([{ plugin: paramOverridePlugin, timeout: 5000 }]);
    ctx = await createTestServer({ plugins });

    await resetMock();
    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    await post(ctx.baseUrl, endpointId, { q: 'London' });

    const calls = await getMockCalls();
    const lastCall = calls.at(-1);
    const url = new URL(lastCall?.url ?? 'http://x');
    // Plugin changed q from London to Tokyo
    expect(url.searchParams.get('q')).toBe('Tokyo');
  });

  test('onAfterApiCall can modify the response', async () => {
    ctx.stop();
    const responseOverridePlugin: AirnodePlugin = {
      name: 'response-override',
      hooks: {
        onAfterApiCall: () => ({ data: { current: { temp_c: 99.9 } }, status: 200 }),
      },
    };
    const plugins = createRegistry([{ plugin: responseOverridePlugin, timeout: 5000 }]);
    ctx = await createTestServer({ plugins });

    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    const response = await post(ctx.baseUrl, endpointId, { q: 'London' });
    const body = (await response.json()) as { data: string };

    expect(response.status).toBe(200);
    // 99.9 * 100 = 9990 as int256 → 0x...2706 (9990 in hex)
    // The mock returns 22.5 which would encode to 2250 (0x...08ca). The plugin overrides to 99.9.
    expect(body.data).toContain('2706');
  });

  test('plugin returning undefined passes through', async () => {
    ctx.stop();
    const noopPlugin: AirnodePlugin = {
      name: 'noop',
      hooks: {
        onBeforeApiCall: () => {},
        onAfterApiCall: () => {},
      },
    };
    const plugins = createRegistry([{ plugin: noopPlugin, timeout: 5000 }]);
    ctx = await createTestServer({ plugins });

    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    const response = await post(ctx.baseUrl, endpointId, { q: 'Berlin' });

    expect(response.status).toBe(200);
  });
});
