import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { CLIENT_API_KEY, createTestServer, findEndpointId, getMockCalls, post, resetMock } from '../helpers';
import type { TestContext } from '../helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestServer();
});

afterAll(() => {
  ctx.stop();
});
beforeEach(() => resetMock());

describe('S25 — Concurrent request handling', () => {
  test('multiple simultaneous requests to different endpoints succeed', async () => {
    const weatherId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    const randomId = findEndpointId(ctx.endpointMap, 'RandomAPI', 'generateInteger');

    const results = await Promise.all([
      post(ctx.baseUrl, weatherId, { q: 'London' }),
      post(ctx.baseUrl, weatherId, { q: 'Tokyo' }),
      post(ctx.baseUrl, randomId, { min: '0', max: '100' }),
    ]);

    for (const r of results) {
      expect(r.status).toBe(200);
    }
  });

  test('concurrent requests to cached endpoint share the cached response', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPrice');
    const params = { ids: 'polkadot' };
    const headers = { 'X-Api-Key': CLIENT_API_KEY };

    // Warm the cache with a single request, then clear the mock's call history
    // so the concurrent burst below can be measured in isolation. The pipeline
    // has no in-flight request coalescing, so without a warmed cache 5
    // simultaneous requests would all miss and all hit the upstream.
    const warm = await post(ctx.baseUrl, endpointId, params, headers);
    expect(warm.status).toBe(200);
    await resetMock();

    const results = await Promise.all(Array.from({ length: 5 }, () => post(ctx.baseUrl, endpointId, params, headers)));

    for (const r of results) {
      expect(r.status).toBe(200);
    }

    const calls = await getMockCalls();
    expect(calls.length).toBe(0);
  });
});
