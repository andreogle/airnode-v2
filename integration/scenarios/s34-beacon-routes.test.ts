import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Hex } from 'viem';
import { deriveBeaconId } from '../../src/sign';
import { createTestServer, findEndpointId } from '../helpers';
import type { TestContext } from '../helpers';

const AIRNODE_ADDRESS: Hex = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestServer({
    // Remove cache delay so beacons are immediately available
    apiOverrides: (apis) =>
      apis.map((api) =>
        api.name === 'CoinGecko'
          ? {
              ...api,
              cache: undefined,
              endpoints: api.endpoints.map((ep) =>
                ep.name === 'coinPrice' ? { ...ep, cache: undefined, push: { interval: 100 } } : ep
              ),
            }
          : api
      ),
  });
  // Wait for push loop to populate beacon store
  await Bun.sleep(300);
});

afterAll(() => {
  ctx.stop();
});

describe('S34 — Beacon push routes', () => {
  test('GET /beacons lists pushed beacons', async () => {
    const response = await fetch(`${ctx.baseUrl}/beacons`);
    const body = (await response.json()) as { beaconId: Hex }[];

    expect(response.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  test('GET /beacons/{beaconId} returns beacon data', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPrice');
    const beaconId = deriveBeaconId(AIRNODE_ADDRESS, endpointId);

    const response = await fetch(`${ctx.baseUrl}/beacons/${beaconId}`);
    const body = (await response.json()) as {
      airnode: Hex;
      endpointId: Hex;
      beaconId: Hex;
      timestamp: number;
      data: Hex;
      signature: Hex;
    };

    expect(response.status).toBe(200);
    expect(body.airnode).toBe(AIRNODE_ADDRESS);
    expect(body.endpointId).toBe(endpointId);
    expect(body.beaconId).toBe(beaconId);
    expect(body.data).toMatch(/^0x/);
    expect(body.signature).toMatch(/^0x/);
    expect(body.timestamp).toBeGreaterThan(0);
  });

  test('GET /beacons/{nonExistent} returns 404', async () => {
    const fakeId = `0x${'ff'.repeat(32)}`;
    const response = await fetch(`${ctx.baseUrl}/beacons/${fakeId}`);

    expect(response.status).toBe(404);
  });
});
