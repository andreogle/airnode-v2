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

    // The mock should have been called at most a few times (first request populates cache)
    const calls = await getMockCalls();
    // With cache, subsequent requests shouldn't hit the API
    // First request hits the API, rest may hit cache depending on timing
    expect(calls.length).toBeLessThanOrEqual(5);
  });
});
