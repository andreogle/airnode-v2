import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Hex } from 'viem';
import { createCacheServer } from './cache-server';
import type { CacheServerHandle } from './cache-server';
import { createAirnodeAccount, deriveBeaconId, signResponse } from './sign';
import type { CacheServerConfig } from './types';

const TEST_PRIVATE_KEY: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_ACCOUNT = createAirnodeAccount(TEST_PRIVATE_KEY);
const TEST_AIRNODE: Hex = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const AUTH_TOKEN = 'test-push-token';
const CLIENT_KEY = 'test-client-key';
const ENDPOINT_ID: Hex = '0x04e77a11d6561a70385e2e8e315989cb24bb35128cb4d5a8b3ece93a3c72295b';
const DATA: Hex = '0x00000000000000000000000000000000000000000000000000000000000003e8';

async function makeSignedBeacon(
  endpointId: Hex = ENDPOINT_ID,
  timestamp = Math.floor(Date.now() / 1000)
): Promise<{
  airnode: Hex;
  endpointId: Hex;
  beaconId: Hex;
  timestamp: number;
  data: Hex;
  signature: Hex;
}> {
  const signed = await signResponse(TEST_ACCOUNT, endpointId, timestamp, DATA);
  const beaconId = deriveBeaconId(TEST_AIRNODE, endpointId);
  return {
    airnode: TEST_AIRNODE,
    endpointId,
    beaconId,
    timestamp,
    data: DATA,
    signature: signed.signature,
  };
}

function makeConfig(overrides: Partial<CacheServerConfig> = {}): CacheServerConfig {
  return {
    version: '1.0',
    server: { port: 0, host: '127.0.0.1' },
    allowedAirnodes: [{ address: TEST_AIRNODE, authToken: AUTH_TOKEN }],
    endpoints: [
      { path: '/realtime', delaySeconds: 0, auth: { type: 'apiKey', keys: [CLIENT_KEY] } },
      { path: '/delayed', delaySeconds: 60, auth: { type: 'free' } },
    ],
    ...overrides,
  } as CacheServerConfig;
}

// =============================================================================
// Helpers
// =============================================================================
function postBeacons(baseUrl: string, airnode: Hex, body: unknown, token = AUTH_TOKEN): Promise<Response> {
  return fetch(`${baseUrl}/beacons/${airnode}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

function getBeacon(baseUrl: string, path: string, beaconId: Hex, apiKey?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (apiKey) headers['X-Api-Key'] = apiKey;
  return fetch(`${baseUrl}${path}/${beaconId}`, { headers });
}

function listBeacons(baseUrl: string, path: string, apiKey?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (apiKey) headers['X-Api-Key'] = apiKey;
  return fetch(`${baseUrl}${path}`, { headers });
}

// =============================================================================
// Tests
// =============================================================================
describe('cache server', () => {
  let server: CacheServerHandle;

  let baseUrl: string;

  beforeAll(() => {
    server = createCacheServer({ config: makeConfig() });
    baseUrl = `http://${server.hostname}:${String(server.port)}`;
  });

  afterAll(() => {
    server.stop();
  });

  // ===========================================================================
  // Health
  // ===========================================================================
  test('GET /health returns ok', async () => {
    const response = await fetch(`${baseUrl}/health`);
    const body = (await response.json()) as { status: string };
    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
  });

  // ===========================================================================
  // Ingestion
  // ===========================================================================
  test('POST with valid signed data returns 200 and stores beacon', async () => {
    const beacon = await makeSignedBeacon();
    const response = await postBeacons(baseUrl, TEST_AIRNODE, beacon);
    const body = (await response.json()) as { count: number; skipped: number; errors: number };

    expect(response.status).toBe(200);
    expect(body.count).toBe(1);
    expect(body.skipped).toBe(0);
    expect(body.errors).toBe(0);
  });

  test('POST with batch (array) stores multiple beacons', async () => {
    const endpointId2: Hex = '0x1111111111111111111111111111111111111111111111111111111111111111';
    const beacon1 = await makeSignedBeacon(ENDPOINT_ID);
    const beacon2 = await makeSignedBeacon(endpointId2);
    const response = await postBeacons(baseUrl, TEST_AIRNODE, [beacon1, beacon2]);
    const body = (await response.json()) as { count: number; skipped: number; errors: number };

    expect(response.status).toBe(200);
    expect(body.count + body.skipped).toBe(2);
    expect(body.errors).toBe(0);
  });

  test('POST with older timestamp is skipped', async () => {
    const now = Math.floor(Date.now() / 1000);
    const fresh = await makeSignedBeacon(ENDPOINT_ID, now + 100);
    await postBeacons(baseUrl, TEST_AIRNODE, fresh);

    const stale = await makeSignedBeacon(ENDPOINT_ID, now - 1000);
    const response = await postBeacons(baseUrl, TEST_AIRNODE, stale);
    const body = (await response.json()) as { count: number; skipped: number };

    expect(response.status).toBe(200);
    expect(body.skipped).toBe(1);
  });

  test('POST with invalid signature counts as error without rejecting batch', async () => {
    const valid = await makeSignedBeacon();
    const invalid = { ...valid, signature: `0x${'ab'.repeat(65)}`, endpointId: `0x${'33'.repeat(32)}` };
    const response = await postBeacons(baseUrl, TEST_AIRNODE, [valid, invalid]);
    const body = (await response.json()) as { count: number; skipped: number; errors: number };

    expect(response.status).toBe(200);
    expect(body.errors).toBe(1);
    expect(body.count + body.skipped).toBeGreaterThanOrEqual(1);
  });

  test('POST with wrong bearer token returns 401', async () => {
    const beacon = await makeSignedBeacon();
    const response = await postBeacons(baseUrl, TEST_AIRNODE, beacon, 'wrong-token');

    expect(response.status).toBe(401);
  });

  test('POST with unknown airnode returns 401', async () => {
    const unknownAirnode: Hex = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
    const beacon = await makeSignedBeacon();
    const response = await postBeacons(baseUrl, unknownAirnode, beacon);

    expect(response.status).toBe(401);
  });

  test('POST with missing authorization header returns 401', async () => {
    const beacon = await makeSignedBeacon();
    const response = await fetch(`${baseUrl}/beacons/${TEST_AIRNODE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(beacon),
    });

    expect(response.status).toBe(401);
  });

  test('POST with empty array returns 400', async () => {
    const response = await postBeacons(baseUrl, TEST_AIRNODE, []);
    expect(response.status).toBe(400);
  });

  test('POST with invalid JSON returns 400', async () => {
    const response = await fetch(`${baseUrl}/beacons/${TEST_AIRNODE}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${AUTH_TOKEN}`,
      },
      body: 'not json{{{',
    });
    expect(response.status).toBe(400);
  });

  test('POST with missing required fields counts as error', async () => {
    const response = await postBeacons(baseUrl, TEST_AIRNODE, { foo: 'bar' });
    const body = (await response.json()) as { errors: number };

    expect(response.status).toBe(200);
    expect(body.errors).toBe(1);
  });

  // ===========================================================================
  // Serving — realtime endpoint (delaySeconds: 0)
  // ===========================================================================
  test('GET /realtime/{beaconId} returns stored beacon', async () => {
    const beacon = await makeSignedBeacon();
    await postBeacons(baseUrl, TEST_AIRNODE, beacon);

    const response = await getBeacon(baseUrl, '/realtime', beacon.beaconId, CLIENT_KEY);
    const body = (await response.json()) as { beaconId: Hex; data: Hex };

    expect(response.status).toBe(200);
    expect(body.beaconId).toBe(beacon.beaconId);
    expect(body.data).toBe(DATA);
  });

  test('GET /realtime/{beaconId} without API key returns 401', async () => {
    const beacon = await makeSignedBeacon();
    await postBeacons(baseUrl, TEST_AIRNODE, beacon);

    const response = await getBeacon(baseUrl, '/realtime', beacon.beaconId);
    expect(response.status).toBe(401);
  });

  test('GET /realtime returns list of all beacons', async () => {
    const response = await listBeacons(baseUrl, '/realtime', CLIENT_KEY);
    const body = (await response.json()) as unknown[];

    expect(response.status).toBe(200);
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  test('GET /realtime/{beaconId} returns 404 for unknown beacon', async () => {
    const unknownId: Hex = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    const response = await getBeacon(baseUrl, '/realtime', unknownId, CLIENT_KEY);

    expect(response.status).toBe(404);
  });

  // ===========================================================================
  // Serving — delayed endpoint (delaySeconds: 60)
  // ===========================================================================
  test('GET /delayed/{beaconId} returns 425 if beacon is too fresh', async () => {
    const now = Math.floor(Date.now() / 1000);
    const beacon = await makeSignedBeacon(ENDPOINT_ID, now);
    await postBeacons(baseUrl, TEST_AIRNODE, beacon);

    const response = await getBeacon(baseUrl, '/delayed', beacon.beaconId);

    expect(response.status).toBe(425);
  });

  test('GET /delayed/{beaconId} returns data if beacon is old enough', async () => {
    const oldEndpointId: Hex = '0x2222222222222222222222222222222222222222222222222222222222222222';
    const oldTimestamp = Math.floor(Date.now() / 1000) - 120;
    const beacon = await makeSignedBeacon(oldEndpointId, oldTimestamp);
    await postBeacons(baseUrl, TEST_AIRNODE, beacon);

    const response = await getBeacon(baseUrl, '/delayed', beacon.beaconId);
    const body = (await response.json()) as { beaconId: Hex };

    expect(response.status).toBe(200);
    expect(body.beaconId).toBe(beacon.beaconId);
  });

  test('GET /delayed lists only beacons that are old enough', async () => {
    const response = await listBeacons(baseUrl, '/delayed');
    const body = (await response.json()) as { timestamp: number }[];

    const nowSeconds = Math.floor(Date.now() / 1000);

    for (const beacon of body) {
      expect(beacon.timestamp + 60).toBeLessThanOrEqual(nowSeconds);
    }
  });

  // ===========================================================================
  // Preflight
  // ===========================================================================
  test('OPTIONS returns 204 with CORS headers', async () => {
    const response = await fetch(`${baseUrl}/beacons/${TEST_AIRNODE}`, { method: 'OPTIONS' });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  // ===========================================================================
  // Not found
  // ===========================================================================
  test('GET /unknown returns 404', async () => {
    const response = await fetch(`${baseUrl}/unknown`);
    expect(response.status).toBe(404);
  });
});

// =============================================================================
// Wildcard allowedAirnodes
// =============================================================================
describe('cache server with wildcard airnodes', () => {
  let server: CacheServerHandle;

  let baseUrl: string;

  beforeAll(() => {
    server = createCacheServer({
      config: makeConfig({
        allowedAirnodes: '*',
        endpoints: [{ path: '/data', delaySeconds: 0, auth: { type: 'free' } }],
      } as Partial<CacheServerConfig>),
    });
    baseUrl = `http://${server.hostname}:${String(server.port)}`;
  });

  afterAll(() => {
    server.stop();
  });

  test('accepts any airnode when allowedAirnodes is wildcard', async () => {
    const beacon = await makeSignedBeacon();
    const response = await postBeacons(baseUrl, TEST_AIRNODE, beacon, 'any-token');
    const body = (await response.json()) as { count: number };

    expect(response.status).toBe(200);
    expect(body.count).toBeGreaterThanOrEqual(0);
  });

  test('rejects empty bearer token even in wildcard mode', async () => {
    const beacon = await makeSignedBeacon();
    const response = await fetch(`${baseUrl}/beacons/${TEST_AIRNODE}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ',
      },
      body: JSON.stringify(beacon),
    });

    expect(response.status).toBe(401);
  });
});

// =============================================================================
// Rate limiting
// =============================================================================
describe('cache server with rate limiting', () => {
  let server: CacheServerHandle;

  let baseUrl: string;

  beforeAll(() => {
    server = createCacheServer({
      config: makeConfig({
        server: { port: 0, host: '127.0.0.1', rateLimit: { window: 60_000, max: 2 } },
        endpoints: [{ path: '/data', delaySeconds: 0, auth: { type: 'free' } }],
      } as Partial<CacheServerConfig>),
    });
    baseUrl = `http://${server.hostname}:${String(server.port)}`;
  });

  afterAll(() => {
    server.stop();
  });

  test('returns 429 when rate limit is exceeded', async () => {
    await fetch(`${baseUrl}/health`);
    await fetch(`${baseUrl}/health`);
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(429);
  });
});
