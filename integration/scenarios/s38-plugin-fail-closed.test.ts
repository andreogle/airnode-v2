import { afterEach, describe, expect, test } from 'bun:test';
import { createRegistry } from '../../src/plugins';
import type { AirnodePlugin } from '../../src/plugins';
import { createTestServer, findEndpointId, post } from '../helpers';
import type { TestContext } from '../helpers';

// =============================================================================
// S38 — Mutation hooks fail closed
//
// onBeforeApiCall / onBeforeSign mutate the request or the data that gets
// signed. A plugin that throws there must not let an unmodified request through
// — the request is dropped (403) rather than fulfilled with the airnode's key.
// (onResponseSent / onError are observation-only and never block a request;
// that is exercised in S15.)
// =============================================================================
let ctx: TestContext;

const beforeApiCrasher: AirnodePlugin = {
  name: 'before-api-crasher',
  hooks: {
    onBeforeApiCall: () => {
      throw new Error('before-api-crasher exploded');
    },
  },
};

const beforeSignCrasher: AirnodePlugin = {
  name: 'before-sign-crasher',
  hooks: {
    onBeforeSign: () => {
      throw new Error('before-sign-crasher exploded');
    },
  },
};

afterEach(() => {
  ctx.stop();
});

describe('S38 — Plugin mutation hooks fail closed', () => {
  test('a throwing onBeforeApiCall drops the request before the upstream call', async () => {
    const plugins = createRegistry([{ plugin: beforeApiCrasher, timeout: 5000 }]);
    ctx = await createTestServer({ plugins });

    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    const response = await post(ctx.baseUrl, endpointId, { q: 'London' });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(403);
    expect(body.error).toBe('Request dropped by plugin');
  });

  test('a throwing onBeforeSign drops the request rather than signing unmodified data', async () => {
    const plugins = createRegistry([{ plugin: beforeSignCrasher, timeout: 5000 }]);
    ctx = await createTestServer({ plugins });

    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    const response = await post(ctx.baseUrl, endpointId, { q: 'London' });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(403);
    expect(body.error).toBe('Request dropped by plugin');
  });

  test('a healthy request still succeeds once the crashing plugin is gone', async () => {
    ctx = await createTestServer();

    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    const response = await post(ctx.baseUrl, endpointId, { q: 'London' });

    expect(response.status).toBe(200);
  });
});
