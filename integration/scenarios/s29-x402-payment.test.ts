import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestServer, findEndpointId, post } from '../helpers';
import type { TestContext } from '../helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestServer();
});

afterAll(() => {
  ctx.stop();
});

describe('S29 — Multi-method auth integration', () => {
  test('endpoint with multi-method auth rejects unauthenticated requests', async () => {
    // coinMarketData has auth: [nftKey, apiKey]
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinMarketData');
    const response = await post(ctx.baseUrl, endpointId, { coinId: 'bitcoin' });

    expect(response.status).toBe(401);
  });

  test('endpoint with multi-method auth accepts API key fallback', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinMarketData');
    const response = await post(ctx.baseUrl, endpointId, { coinId: 'bitcoin' }, { 'X-Api-Key': 'test-client-key' });

    expect(response.status).toBe(200);
  });

  test('unknown endpoint returns 404', async () => {
    const fakeId = '0x0000000000000000000000000000000000000000000000000000000000000001';
    const response = await post(ctx.baseUrl, fakeId, {});

    expect(response.status).toBe(404);
  });
});
