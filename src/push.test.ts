import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Hex } from 'viem';
import { deriveEndpointId } from './endpoint';
import { startPushLoop } from './push';
import type { PushDependencies } from './push';
import { createAirnodeAccount, deriveBeaconId } from './sign';
import type { Api, Endpoint } from './types';

const TEST_PRIVATE_KEY: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_ACCOUNT = createAirnodeAccount(TEST_PRIVATE_KEY);
const TEST_AIRNODE: Hex = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

const fetchMock = mock();
const originalFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

const DEFAULT_MOCK_DATA = { price: 3000 };

function mockFetchResponse(data: unknown = DEFAULT_MOCK_DATA): void {
  fetchMock.mockResolvedValue({
    text: () => Promise.resolve(JSON.stringify(data)),
    status: 200,
  });
}

function makeApi(): Api {
  return { name: 'TestAPI', url: 'https://api.example.com', timeout: 10_000, endpoints: [] } as Api;
}

function makeEndpoint(overrides: Partial<Endpoint> = {}): Endpoint {
  return {
    name: 'price',
    path: '/price',
    method: 'GET',
    parameters: [],
    encoding: { type: 'int256', path: '$.price' },
    push: { interval: 100 },
    ...overrides,
  } as Endpoint;
}

function makeDeps(api: Api = makeApi(), endpoint: Endpoint = makeEndpoint()): PushDependencies {
  const id = deriveEndpointId(api, endpoint);
  const endpointMap = new Map<Hex, { api: Api; endpoint: Endpoint }>([[id, { api, endpoint }]]);
  return { account: TEST_ACCOUNT, airnode: TEST_AIRNODE, endpointMap };
}

describe('startPushLoop', () => {
  beforeEach(() => {
    mockFetchResponse();
  });

  afterEach(() => {
    fetchMock.mockClear();
  });

  test('populates beacon store after initial update', async () => {
    const push = startPushLoop(makeDeps());
    await Bun.sleep(50);

    const beacons = push.store.list();
    expect(beacons.length).toBe(1);
    expect(beacons[0]?.airnode).toBe(TEST_AIRNODE);
    expect(beacons[0]?.data).toMatch(/^0x/);
    expect(beacons[0]?.signature).toMatch(/^0x/);

    push.stop();
  });

  test('beacon is retrievable by ID', async () => {
    const api = makeApi();
    const endpoint = makeEndpoint();
    const push = startPushLoop(makeDeps(api, endpoint));
    await Bun.sleep(50);

    const endpointId = deriveEndpointId(api, endpoint);
    const beaconId = deriveBeaconId(TEST_AIRNODE, endpointId);
    const beacon = push.store.get(beaconId);

    expect(beacon).toBeDefined();
    expect(beacon?.beaconId).toBe(beaconId);
    expect(beacon?.endpointId).toBe(endpointId);

    push.stop();
  });

  test('skips endpoints without push config', async () => {
    const push = startPushLoop(makeDeps(makeApi(), makeEndpoint({ push: undefined })));
    await Bun.sleep(50);

    expect(push.store.list().length).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();

    push.stop();
  });

  test('skips endpoints without encoding', async () => {
    const push = startPushLoop(makeDeps(makeApi(), makeEndpoint({ encoding: undefined })));
    await Bun.sleep(150);

    expect(push.store.list().length).toBe(0);

    push.stop();
  });

  test('updates beacon periodically', async () => {
    const push = startPushLoop(makeDeps());
    await Bun.sleep(250);

    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);

    push.stop();
  });

  test('stop() clears all intervals', async () => {
    const push = startPushLoop(makeDeps());
    await Bun.sleep(50);
    push.stop();

    const callCount = fetchMock.mock.calls.length;
    await Bun.sleep(200);

    expect(fetchMock.mock.calls.length).toBe(callCount);
  });
});
