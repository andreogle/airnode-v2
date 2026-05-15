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

describe('S32 — Requester-specified encoding (operator opts in with `*`)', () => {
  test('client _type/_path/_times fill in the wildcards', async () => {
    // coinPriceFlex has encoding: { type: '*', path: '*', times: '*' }
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPriceFlex');
    const response = await post(
      ctx.baseUrl,
      endpointId,
      { ids: 'ethereum', vs_currencies: 'usd', _type: 'int256', _path: '$.ethereum.usd', _times: '1e18' },
      { 'X-Api-Key': CLIENT_API_KEY }
    );
    const body = (await response.json()) as { data: Hex; signature: Hex };

    expect(response.status).toBe(200);
    expect(body.signature).toMatch(/^0x/);

    const [decoded] = decodeAbiParameters([{ type: 'int256' }], body.data);
    // 3000.5 * 1e18
    expect(decoded).toBeGreaterThan(3_000_000_000_000_000_000_000n);
    expect(decoded).toBeLessThan(3_001_000_000_000_000_000_000n);
  });

  test('returns 400 when a wildcard reserved param is missing', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPriceFlex');
    const response = await post(
      ctx.baseUrl,
      endpointId,
      { ids: 'ethereum', vs_currencies: 'usd', _type: 'int256', _times: '1e18' }, // missing _path
      { 'X-Api-Key': CLIENT_API_KEY }
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain('_path');
  });

  test('no encoding block returns raw JSON — reserved params are ignored', async () => {
    // coinPriceRaw has no encoding block. Client _type/_path must NOT synthesize
    // an encoding out of nothing — raw mode wins.
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPriceRaw');
    const response = await post(
      ctx.baseUrl,
      endpointId,
      { ids: 'ethereum', vs_currencies: 'usd', _type: 'int256', _path: '$.ethereum.usd' },
      { 'X-Api-Key': CLIENT_API_KEY }
    );
    const body = (await response.json()) as { rawData: unknown; data: undefined };

    expect(response.status).toBe(200);
    expect(body.rawData).toBeDefined();
    expect(body.data).toBeUndefined();
  });

  test('operator-pinned encoding silently ignores client reserved params', async () => {
    // coinPrice HAS a fully-pinned encoding block — requester params must be ignored
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPrice');
    const response = await post(
      ctx.baseUrl,
      endpointId,
      { ids: 'ethereum', _type: 'uint256', _path: '$.ethereum.usd_24h_vol' },
      { 'X-Api-Key': CLIENT_API_KEY }
    );
    const body = (await response.json()) as { data: Hex };

    expect(response.status).toBe(200);
    const [decoded] = decodeAbiParameters([{ type: 'int256' }], body.data);
    // 3000.5 * 1e18 — price, NOT volume the client tried to swap to
    expect(decoded).toBeGreaterThan(3_000_000_000_000_000_000_000n);
    expect(decoded).toBeLessThan(3_001_000_000_000_000_000_000n);
  });
});
