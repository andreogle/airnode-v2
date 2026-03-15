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

describe('S7 — Response caching', () => {
  // coinPriceRaw inherits API-level cache (maxAge: 30000, no delay)
  test('second request with same params returns cached response (mock called once)', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPriceRaw');

    const r1 = await post(
      ctx.baseUrl,
      endpointId,
      { ids: 'bitcoin', vs_currencies: 'usd' },
      { 'X-Api-Key': CLIENT_API_KEY }
    );
    expect(r1.status).toBe(200);

    await resetMock();
    const r2 = await post(
      ctx.baseUrl,
      endpointId,
      { ids: 'bitcoin', vs_currencies: 'usd' },
      { 'X-Api-Key': CLIENT_API_KEY }
    );
    expect(r2.status).toBe(200);

    const calls = await getMockCalls();
    expect(calls.length).toBe(0);
  });

  test('cached response has identical data and signature', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPriceRaw');

    const r1 = await post(
      ctx.baseUrl,
      endpointId,
      { ids: 'litecoin', vs_currencies: 'usd' },
      { 'X-Api-Key': CLIENT_API_KEY }
    );
    const body1 = (await r1.json()) as Record<string, unknown>;

    const r2 = await post(
      ctx.baseUrl,
      endpointId,
      { ids: 'litecoin', vs_currencies: 'usd' },
      { 'X-Api-Key': CLIENT_API_KEY }
    );
    const body2 = (await r2.json()) as Record<string, unknown>;

    expect(body2.rawData).toEqual(body1.rawData);
    expect(body2.signature).toBe(body1.signature);
    expect(body2.timestamp).toBe(body1.timestamp);
  });

  test('different parameters produce different cache entries', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPriceRaw');

    await post(ctx.baseUrl, endpointId, { ids: 'cardano', vs_currencies: 'usd' }, { 'X-Api-Key': CLIENT_API_KEY });
    await resetMock();
    await post(ctx.baseUrl, endpointId, { ids: 'dogecoin', vs_currencies: 'usd' }, { 'X-Api-Key': CLIENT_API_KEY });

    const calls = await getMockCalls();
    expect(calls.length).toBe(1);
  });

  test('endpoint without cache config does not cache', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');

    await post(ctx.baseUrl, endpointId, { q: 'Paris' });
    await resetMock();
    await post(ctx.baseUrl, endpointId, { q: 'Paris' });

    const calls = await getMockCalls();
    expect(calls.length).toBe(1);
  });
});
