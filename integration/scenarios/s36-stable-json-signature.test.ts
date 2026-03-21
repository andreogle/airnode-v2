import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type Hex, encodePacked, hashMessage, keccak256, toHex } from 'viem';
import { recoverAddress } from 'viem';
import { AIRNODE_ADDRESS, CLIENT_API_KEY, createTestServer, findEndpointId, post, setMockResponse } from '../helpers';
import type { TestContext } from '../helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestServer();
});

afterAll(() => {
  ctx.stop();
});

describe('S36 — Stable JSON signature for raw responses', () => {
  test('signature is stable regardless of upstream key order', async () => {
    // Set mock to return keys in non-alphabetical order with nested objects
    await setMockResponse('/simple/price', { z: 1, a: 2, m: { b: 3, a: 4 } });

    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPriceRaw');
    const response = await post(
      ctx.baseUrl,
      endpointId,
      { ids: 'ethereum', vs_currencies: 'usd' },
      { 'X-Api-Key': CLIENT_API_KEY }
    );
    const body = (await response.json()) as {
      endpointId: Hex;
      timestamp: number;
      rawData: unknown;
      signature: Hex;
    };

    expect(response.status).toBe(200);

    // The signature must be computed over keys in sorted order (stableStringify)
    // stableStringify sorts keys recursively: {"a":2,"m":{"a":4,"b":3},"z":1}
    const stableSerialized = '{"a":2,"m":{"a":4,"b":3},"z":1}';
    const dataHash = keccak256(toHex(stableSerialized));
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
