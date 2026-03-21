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

  test('pushes to targets after beacon update', async () => {
    const endpoint = makeEndpoint({
      push: {
        interval: 100,
        targets: [{ url: 'https://cache.example.com/beacons/0xabc', authToken: 'test-token' }],
      },
    });
    const push = startPushLoop(makeDeps(makeApi(), endpoint));
    await Bun.sleep(50);

    // First call is the upstream API, second is the target POST
    const targetCalls = fetchMock.mock.calls.filter(
      (call: unknown[]) => (call[0] as string) === 'https://cache.example.com/beacons/0xabc'
    );
    expect(targetCalls.length).toBeGreaterThanOrEqual(1);

    const targetOptions = targetCalls[0]?.[1] as RequestInit;
    expect(targetOptions.method).toBe('POST');
    expect((targetOptions.headers as Record<string, string>)['Authorization']).toBe('Bearer test-token');
    expect((targetOptions.headers as Record<string, string>)['Content-Type']).toBe('application/json');

    const body = JSON.parse(targetOptions.body as string) as { airnode: string; signature: string };
    expect(body.airnode).toBe(TEST_AIRNODE);
    expect(body.signature).toMatch(/^0x/);

    push.stop();
  });

  test('logs warning on target failure without blocking push loop', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === 'https://broken.example.com/beacons') {
        return Promise.reject(new Error('Connection refused'));
      }
      return Promise.resolve({ text: () => Promise.resolve(JSON.stringify(DEFAULT_MOCK_DATA)), status: 200 });
    });

    const endpoint = makeEndpoint({
      push: {
        interval: 100,
        targets: [{ url: 'https://broken.example.com/beacons', authToken: 'token' }],
      },
    });
    const push = startPushLoop(makeDeps(makeApi(), endpoint));
    await Bun.sleep(50);

    // Beacon store should still be populated despite target failure
    expect(push.store.list().length).toBe(1);

    push.stop();
  });

  test('retries push to targets on failure', async () => {
    let callCount = 0;
    fetchMock.mockImplementation((url: string) => {
      if (url === 'https://flaky.example.com/beacons') {
        callCount++;
        if (callCount <= 2) {
          return Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve('') });
        }
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{}') });
      }
      return Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(DEFAULT_MOCK_DATA)), status: 200 });
    });

    const endpoint = makeEndpoint({
      push: {
        interval: 60_000, // long interval so only one update fires
        targets: [{ url: 'https://flaky.example.com/beacons', authToken: 'token' }],
      },
    });
    const push = startPushLoop(makeDeps(makeApi(), endpoint));
    // Wait long enough for retries (1s + 2s + processing time)
    await Bun.sleep(4000);

    const flakyCalls = fetchMock.mock.calls.filter(
      (call: unknown[]) => (call[0] as string) === 'https://flaky.example.com/beacons'
    );
    // Should have retried: initial + 2 retries = 3 attempts total
    expect(flakyCalls.length).toBe(3);

    push.stop();
  }, 10_000);

  test('works with no targets configured', async () => {
    const endpoint = makeEndpoint({ push: { interval: 100 } });
    const push = startPushLoop(makeDeps(makeApi(), endpoint));
    await Bun.sleep(50);

    // Only the upstream API call, no target calls
    expect(push.store.list().length).toBe(1);
    const targetCalls = fetchMock.mock.calls.filter(
      (call: unknown[]) => (call[0] as string) !== 'https://api.example.com/price'
    );
    expect(targetCalls.length).toBe(0);

    push.stop();
  });
});
