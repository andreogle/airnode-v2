import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type Hex, decodeAbiParameters, encodePacked, keccak256 } from 'viem';
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

describe('S1 — Signed response round-trip', () => {
  test('returns all required fields', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPrice');
    const response = await post(ctx.baseUrl, endpointId, { ids: 'ethereum' }, { 'X-Api-Key': CLIENT_API_KEY });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.airnode).toBe(AIRNODE_ADDRESS);
    expect(body.endpointId).toBe(endpointId);
    expect(typeof body.timestamp).toBe('number');
    expect((body.data as string).startsWith('0x')).toBe(true);
    expect((body.signature as string).startsWith('0x')).toBe(true);
  });

  test('signature recovers to the airnode address', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPrice');
    const response = await post(ctx.baseUrl, endpointId, { ids: 'ethereum' }, { 'X-Api-Key': CLIENT_API_KEY });
    const body = (await response.json()) as {
      endpointId: Hex;
      timestamp: number;
      data: Hex;
      signature: Hex;
      airnode: Hex;
    };

    const messageHash = keccak256(
      encodePacked(['bytes32', 'uint256', 'bytes'], [body.endpointId, BigInt(body.timestamp), body.data])
    );
    const recovered = await recoverAddress({
      hash: hashMessage({ raw: messageHash }),
      signature: body.signature,
    });

    expect(recovered).toBe(AIRNODE_ADDRESS);
    expect(recovered).toBe(body.airnode);
  });

  test('ABI-encoded data decodes to the correct type', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPrice');
    const response = await post(ctx.baseUrl, endpointId, { ids: 'ethereum' }, { 'X-Api-Key': CLIENT_API_KEY });
    const body = (await response.json()) as { data: Hex };

    // 3000.5 * 1e18 — JS float precision means we check the magnitude, not exact value
    const [decoded] = decodeAbiParameters([{ type: 'int256' }], body.data);
    expect(decoded).toBeGreaterThan(3_000_000_000_000_000_000_000n);
    expect(decoded).toBeLessThan(3_001_000_000_000_000_000_000n);
  });

  test('endpointId matches derivation from config', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPrice');
    const response = await post(ctx.baseUrl, endpointId, { ids: 'ethereum' }, { 'X-Api-Key': CLIENT_API_KEY });
    const body = (await response.json()) as { endpointId: Hex };

    expect(body.endpointId).toBe(endpointId);
  });
});
