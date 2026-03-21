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

describe('S32 — Requester-specified encoding', () => {
  test('encodes response when client sends _type and _path', async () => {
    // coinPriceRaw has no encoding block — uses requester params
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPriceRaw');
    const response = await post(
      ctx.baseUrl,
      endpointId,
      { ids: 'ethereum', vs_currencies: 'usd', _type: 'int256', _path: '$.ethereum.usd', _times: '1e18' },
      { 'X-Api-Key': CLIENT_API_KEY }
    );
    const body = (await response.json()) as { data: Hex; signature: Hex };

    expect(response.status).toBe(200);
    expect(body.data).toMatch(/^0x/);
    expect(body.signature).toMatch(/^0x/);

    // Decode: 3000.5 * 1e18 ≈ 3000.5e18
    const [decoded] = decodeAbiParameters([{ type: 'int256' }], body.data);
    expect(decoded).toBeGreaterThan(3_000_000_000_000_000_000_000n);
    expect(decoded).toBeLessThan(3_001_000_000_000_000_000_000n);
  });

  test('returns raw JSON when no encoding and no reserved params', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPriceRaw');
    const response = await post(
      ctx.baseUrl,
      endpointId,
      { ids: 'ethereum', vs_currencies: 'usd' },
      { 'X-Api-Key': CLIENT_API_KEY }
    );
    const body = (await response.json()) as { rawData: unknown; data: undefined };

    expect(response.status).toBe(200);
    expect(body.rawData).toBeDefined();
    expect(body.data).toBeUndefined();
  });

  test('returns 400 when _type is provided without _path', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPriceRaw');
    const response = await post(
      ctx.baseUrl,
      endpointId,
      { ids: 'ethereum', vs_currencies: 'usd', _type: 'int256' },
      { 'X-Api-Key': CLIENT_API_KEY }
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain('_type');
    expect(body.error).toContain('_path');
  });

  test('operator-fixed encoding takes precedence', async () => {
    // coinPrice HAS an encoding block — requester params should be ignored
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPrice');
    const response = await post(
      ctx.baseUrl,
      endpointId,
      { ids: 'ethereum', _type: 'uint256', _path: '$.ethereum.usd_24h_vol' },
      { 'X-Api-Key': CLIENT_API_KEY }
    );
    const body = (await response.json()) as { data: Hex };

    expect(response.status).toBe(200);
    // Should encode $.ethereum.usd (operator-fixed), not $.ethereum.usd_24h_vol
    const [decoded] = decodeAbiParameters([{ type: 'int256' }], body.data);
    // 3000.5 * 1e18 — price, not volume
    expect(decoded).toBeGreaterThan(3_000_000_000_000_000_000_000n);
    expect(decoded).toBeLessThan(3_001_000_000_000_000_000_000n);
  });
});
