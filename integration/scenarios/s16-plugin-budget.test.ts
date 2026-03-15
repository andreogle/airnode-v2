import { afterAll, describe, expect, test, mock } from 'bun:test';
import { createRegistry } from '../../src/plugins';
import type { AirnodePlugin } from '../../src/plugins';
import { createTestServer, findEndpointId, post } from '../helpers';
import type { TestContext } from '../helpers';

let ctx: TestContext;

describe('S16 — Plugin budget exhaustion', () => {
  afterAll(() => {
    ctx.stop();
  });

  test('mutation hook drops request when budget is exhausted', async () => {
    const slowPlugin: AirnodePlugin = {
      name: 'slow',
      hooks: {
        onBeforeApiCall: () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({ parameters: {} });
            }, 500);
          }),
      },
    };
    // 50ms budget — the 500ms hook will exceed it
    const plugins = createRegistry([{ plugin: slowPlugin, timeout: 50 }]);
    ctx = await createTestServer({ plugins });

    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    const response = await post(ctx.baseUrl, endpointId, { q: 'London' });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(403);
    expect(body.error).toContain('dropped');
  });

  test('observation hook is skipped silently when budget is exhausted', async () => {
    ctx.stop();
    const sentMock = mock();
    const plugin: AirnodePlugin = {
      name: 'exhausted',
      hooks: { onResponseSent: sentMock },
    };
    // 0ms budget — hook should be skipped immediately
    const plugins = createRegistry([{ plugin, timeout: 0 }]);
    ctx = await createTestServer({ plugins });

    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    const response = await post(ctx.baseUrl, endpointId, { q: 'London' });

    await Bun.sleep(50);

    // Response succeeds but observation hook was skipped
    expect(response.status).toBe(200);
    expect(sentMock).not.toHaveBeenCalled();
  });

  test('budget resets between requests', async () => {
    ctx.stop();
    const hookMock = mock();
    const plugin: AirnodePlugin = {
      name: 'fast',
      hooks: { onResponseSent: hookMock },
    };
    const plugins = createRegistry([{ plugin, timeout: 5000 }]);
    ctx = await createTestServer({ plugins });

    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');

    await post(ctx.baseUrl, endpointId, { q: 'London' });
    await Bun.sleep(50);
    expect(hookMock).toHaveBeenCalledTimes(1);

    // Second request — budget should have reset
    await post(ctx.baseUrl, endpointId, { q: 'Tokyo' });
    await Bun.sleep(50);
    expect(hookMock).toHaveBeenCalledTimes(2);
  });
});
