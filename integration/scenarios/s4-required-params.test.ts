import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { CLIENT_API_KEY, createTestServer, findEndpointId, post } from '../helpers';
import type { TestContext } from '../helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestServer();
});

afterAll(() => {
  ctx.stop();
});

describe('S4 — Required parameter validation', () => {
  test('succeeds when all required parameters are provided', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPrice');
    // vs_currencies has default: usd, so only ids is truly required without a default
    const response = await post(ctx.baseUrl, endpointId, { ids: 'ethereum' }, { 'X-Api-Key': CLIENT_API_KEY });

    expect(response.status).toBe(200);
  });

  test('returns 400 when a required parameter is missing', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPrice');
    const response = await post(ctx.baseUrl, endpointId, {}, { 'X-Api-Key': CLIENT_API_KEY });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain('ids');
  });

  test('required parameter with fixed value does not need to be in request', async () => {
    // coinMarketData: coinId is required (path), localization and tickers are fixed
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinMarketData');
    const response = await post(ctx.baseUrl, endpointId, { coinId: 'bitcoin' }, { 'X-Api-Key': CLIENT_API_KEY });

    expect(response.status).toBe(200);
  });

  test('non-required parameters can be omitted', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    const response = await post(ctx.baseUrl, endpointId, { q: 'London' });

    expect(response.status).toBe(200);
  });

  test('returns 400 listing all missing required parameters', async () => {
    // coinPriceRaw requires both ids and vs_currencies (no defaults)
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPriceRaw');
    const response = await post(ctx.baseUrl, endpointId, {}, { 'X-Api-Key': CLIENT_API_KEY });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain('ids');
    expect(body.error).toContain('vs_currencies');
  });
});
