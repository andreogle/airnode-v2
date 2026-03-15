import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type Hex, decodeAbiParameters } from 'viem';
import { CLIENT_API_KEY, createTestServer, findEndpointId, post } from '../helpers';
import type { TestContext } from '../helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestServer();
});

afterAll(() => {
  ctx.stop();
});

describe('S18 — Multi-value encoding', () => {
  test('encodes multiple comma-separated values', async () => {
    // coinPriceMulti has encoding: type: int256,uint256, path: $.ethereum.usd,$.ethereum.usd_24h_vol
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPriceMulti');
    const response = await post(ctx.baseUrl, endpointId, { ids: 'ethereum' }, { 'X-Api-Key': CLIENT_API_KEY });
    const body = (await response.json()) as { data: Hex };

    expect(response.status).toBe(200);

    const [price, volume] = decodeAbiParameters([{ type: 'int256' }, { type: 'uint256' }], body.data);

    // Mock returns usd: 3000.5, usd_24h_vol: 15_000_000
    // price = 3000.5 * 1e18 (float precision)
    expect(price).toBeGreaterThan(3_000_000_000_000_000_000_000n);
    expect(price).toBeLessThan(3_001_000_000_000_000_000_000n);
    // volume = 15_000_000 * 1e18
    expect(volume).toBeGreaterThan(14_999_000_000_000_000_000_000_000n);
    expect(volume).toBeLessThan(15_001_000_000_000_000_000_000_000n);
  });
});
