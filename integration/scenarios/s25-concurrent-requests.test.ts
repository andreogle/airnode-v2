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

    // Fire 5 concurrent requests with same params
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        post(ctx.baseUrl, endpointId, { ids: 'polkadot' }, { 'X-Api-Key': CLIENT_API_KEY })
      )
    );

    for (const r of results) {
      expect(r.status).toBe(200);
    }

    // At least one request must hit the API (cache was empty), but with caching
    // enabled, not all 5 should hit the upstream — some should be served from cache
    const calls = await getMockCalls();
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls.length).toBeLessThan(5);
  });
});
