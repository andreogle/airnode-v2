import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type Hex, encodePacked, keccak256, toHex } from 'viem';
import { recoverAddress, hashMessage } from 'viem';
import { AIRNODE_ADDRESS, CLIENT_API_KEY, createTestServer, findEndpointId, post } from '../helpers';
import type { TestContext } from '../helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestServer();
});

afterAll(() => {
  ctx.stop();
});

describe('S2 — Raw response (no encoding)', () => {
  test('returns rawData instead of data', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPriceRaw');
    const response = await post(
      ctx.baseUrl,
      endpointId,
      { ids: 'ethereum', vs_currencies: 'usd' },
      { 'X-Api-Key': CLIENT_API_KEY }
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.rawData).toBeDefined();
    expect(body.data).toBeUndefined();
  });

  test('signature covers the JSON hash', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPriceRaw');
    const response = await post(
      ctx.baseUrl,
      endpointId,
      { ids: 'ethereum', vs_currencies: 'usd' },
      { 'X-Api-Key': CLIENT_API_KEY }
    );
    const body = (await response.json()) as { endpointId: Hex; timestamp: number; rawData: unknown; signature: Hex };

    const dataHash = keccak256(toHex(JSON.stringify(body.rawData)));
    const messageHash = keccak256(
      encodePacked(['bytes32', 'uint256', 'bytes'], [body.endpointId, BigInt(body.timestamp), dataHash])
    );
    const recovered = await recoverAddress({
      hash: hashMessage({ raw: messageHash }),
      signature: body.signature,
    });

    expect(recovered).toBe(AIRNODE_ADDRESS);
  });
});
