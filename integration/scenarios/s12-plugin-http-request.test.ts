import { afterAll, describe, expect, test } from 'bun:test';
import { createRegistry } from '../../src/plugins';
import type { AirnodePlugin } from '../../src/plugins';
import { createTestServer, findEndpointId, post } from '../helpers';
import type { TestContext } from '../helpers';

let ctx: TestContext;

const rejectPlugin: AirnodePlugin = {
  name: 'blocker',
  hooks: {
    onHttpRequest: () => ({ reject: true as const, status: 403, message: 'Blocked by plugin' }),
  },
};

const passPlugin: AirnodePlugin = {
  name: 'pass-through',
  hooks: {
    onHttpRequest: () => {},
  },
};

const crashPlugin: AirnodePlugin = {
  name: 'crasher',
  hooks: {
    onHttpRequest: () => {
      throw new Error('plugin crash');
    },
  },
};

describe('S12 — Plugin hooks — onHttpRequest', () => {
  afterAll(() => {
    ctx.stop();
  });

  test('plugin can reject a request', async () => {
    const plugins = createRegistry([{ plugin: rejectPlugin, timeout: 5000 }]);
    ctx = await createTestServer({ plugins });

    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    const response = await post(ctx.baseUrl, endpointId, { q: 'London' });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(403);
    expect(body.error).toBe('Blocked by plugin');
  });

  test('plugin returning undefined allows request through', async () => {
    ctx.stop();
    const plugins = createRegistry([{ plugin: passPlugin, timeout: 5000 }]);
    ctx = await createTestServer({ plugins });

    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    const response = await post(ctx.baseUrl, endpointId, { q: 'London' });

    expect(response.status).toBe(200);
  });

  test('plugin error does not crash the server', async () => {
    ctx.stop();
    const plugins = createRegistry([{ plugin: crashPlugin, timeout: 5000 }]);
    ctx = await createTestServer({ plugins });

    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    const response = await post(ctx.baseUrl, endpointId, { q: 'London' });

    // Error is caught, request proceeds
    expect(response.status).toBe(200);
  });
});
