import { afterAll, describe, expect, test, mock } from 'bun:test';
import { createRegistry } from '../../src/plugins';
import type { AirnodePlugin } from '../../src/plugins';
import { createTestServer, findEndpointId, post, resetMock, setMockResponse } from '../helpers';
import type { TestContext } from '../helpers';

let ctx: TestContext;

describe('S15 — Plugin hooks — onResponseSent / onError', () => {
  afterAll(() => {
    ctx.stop();
  });

  test('onResponseSent fires after successful response with duration', async () => {
    const sentMock = mock();
    const sentPlugin: AirnodePlugin = {
      name: 'sent-observer',
      hooks: { onResponseSent: sentMock },
    };
    const plugins = createRegistry([{ plugin: sentPlugin, timeout: 5000 }]);
    ctx = await createTestServer({ plugins });

    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    await post(ctx.baseUrl, endpointId, { q: 'London' });

    // Give the fire-and-forget plugin call time to complete
    await Bun.sleep(50);

    expect(sentMock).toHaveBeenCalledTimes(1);
    const callArg = sentMock.mock.calls[0]?.[0] as { duration: number; signal: AbortSignal };
    expect(typeof callArg.duration).toBe('number');
    expect(callArg.duration).toBeGreaterThanOrEqual(0);
  });

  test('onError fires when upstream API call fails', async () => {
    ctx.stop();
    const errorMock = mock();
    const errorPlugin: AirnodePlugin = {
      name: 'error-observer',
      hooks: { onError: errorMock },
    };
    const plugins = createRegistry([{ plugin: errorPlugin, timeout: 5000 }]);
    ctx = await createTestServer({ plugins });

    // Set the mock to return something that will fail processing
    // Use a path that returns the default mock response but with an endpoint
    // that expects a specific JSONPath that won't match
    await setMockResponse('/current.json', { wrong: 'shape' });

    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    const response = await post(ctx.baseUrl, endpointId, { q: 'London' });

    // API call itself succeeds, but processResponse will throw because $.current.temp_c
    // doesn't exist → caught by go() → 502 → onError fires
    expect(response.status).toBe(502);

    await Bun.sleep(50);
    expect(errorMock).toHaveBeenCalledTimes(1);
  });

  test('plugin error in observation hook does not affect response', async () => {
    ctx.stop();
    await resetMock();
    const crashPlugin: AirnodePlugin = {
      name: 'crash-observer',
      hooks: {
        onResponseSent: () => {
          throw new Error('observer crash');
        },
      },
    };
    const plugins = createRegistry([{ plugin: crashPlugin, timeout: 5000 }]);
    ctx = await createTestServer({ plugins });

    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    const response = await post(ctx.baseUrl, endpointId, { q: 'Tokyo' });

    // Response should succeed despite the plugin crash
    expect(response.status).toBe(200);
  });
});
