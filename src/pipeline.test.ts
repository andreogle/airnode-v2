import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { type Hex, hexToBytes } from 'viem';
import { createAsyncRequestStore } from './async';
import type { AsyncRequestStore, PendingRequest } from './async';
import { createCache } from './cache';
import { deriveEndpointId } from './endpoint';
import type { ResolvedEndpoint } from './endpoint';
import { handleEndpointRequest } from './pipeline';
import type { PipelineDependencies, RawResponseBody, SignedResponseBody } from './pipeline';
import { createEmptyRegistry } from './plugins';
import { createSemaphore } from './semaphore';
import { createAirnodeAccount } from './sign';
import type { Api, ClientAuth, Endpoint } from './types';

const TEST_PRIVATE_KEY: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_AIRNODE: Hex = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const TEST_ACCOUNT = createAirnodeAccount(TEST_PRIVATE_KEY);
const UNKNOWN_ENDPOINT_ID: Hex = '0x0000000000000000000000000000000000000000000000000000000000000001';

// =============================================================================
// Mock fetch
// =============================================================================
const originalFetch = globalThis.fetch;
const fetchMock = mock();

beforeAll(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

function mockFetchResponse(data?: unknown, status = 200): void {
  const responseData = data ?? { price: 3000 };
  fetchMock.mockResolvedValue({
    text: () => Promise.resolve(JSON.stringify(responseData)),
    status,
  });
}

// =============================================================================
// Mock the FHE relayer SDK (lazily imported by src/fhe.ts, so this is in place
// by the time an encrypt endpoint exercises it)
// =============================================================================
void mock.module('@zama-fhe/relayer-sdk/node', () => ({
  SepoliaConfig: { relayerUrl: 'https://relayer.testnet.zama.cloud' },
  MainnetConfig: { relayerUrl: 'https://relayer.mainnet.zama.cloud' },
  createInstance: () =>
    Promise.resolve({
      createEncryptedInput: () => {
        const builder = {
          add256: () => builder,
          encrypt: () =>
            Promise.resolve({ handles: [hexToBytes(`0x${'ab'.repeat(32)}`)], inputProof: hexToBytes('0xdeadbeef') }),
        };
        return builder;
      },
    }),
}));

const FHE_SETTINGS = {
  timeout: 10_000,
  maxConcurrentApiCalls: 50,
  proof: 'none' as const,
  fhe: { network: 'sepolia' as const, rpcUrl: 'https://eth-sepolia.example.com', verifier: TEST_AIRNODE },
  plugins: [],
};

// abi.encode(bytes32 0xabab…ab, bytes 0xdeadbeef) — what the mock above produces.
const EXPECTED_CIPHERTEXT =
  '0xabababababababababababababababababababababababababababababababab00000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000004deadbeef00000000000000000000000000000000000000000000000000000000';

// =============================================================================
// Helpers
// =============================================================================
function makeApi(overrides: Partial<Api> = {}): Api {
  return {
    name: 'test-api',
    url: 'https://api.example.com',
    timeout: 10_000,
    endpoints: [],
    ...overrides,
  };
}

function makeEndpoint(overrides: Partial<Endpoint> = {}): Endpoint {
  return {
    name: 'test-endpoint',
    path: '/data',
    method: 'GET',
    parameters: [],
    ...overrides,
  } as Endpoint;
}

function makeResolved(apiOverrides: Partial<Api> = {}, endpointOverrides: Partial<Endpoint> = {}): ResolvedEndpoint {
  return {
    api: makeApi(apiOverrides),
    endpoint: makeEndpoint(endpointOverrides),
  };
}

function makeEndpointMap(...entries: readonly ResolvedEndpoint[]): ReadonlyMap<Hex, ResolvedEndpoint> {
  return new Map(entries.map((resolved) => [deriveEndpointId(resolved.api, resolved.endpoint), resolved]));
}

function makeDeps(overrides: Partial<PipelineDependencies> = {}): PipelineDependencies {
  return {
    account: TEST_ACCOUNT,
    airnode: TEST_AIRNODE,
    endpointMap: new Map(),
    plugins: createEmptyRegistry(),
    cache: createCache(),
    apiCallSemaphore: createSemaphore(100),
    settings: { timeout: 10_000, maxConcurrentApiCalls: 50, proof: 'none', fhe: 'none', plugins: [] },
    rateLimit: {
      window: 60_000,
      max: 1_000_000,
      trustForwardedFor: false,
      x402: { window: 60_000, max: 1_000_000 },
    },
    ...overrides,
  };
}

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://test/endpoints/0x00', { headers });
}

// Async mode runs the pipeline in a fire-and-forget background task; poll the
// store until the request leaves the running state (or give up after ~1s).
async function drainAsync(store: AsyncRequestStore, requestId: Hex, attempts = 200): Promise<PendingRequest> {
  const entry = store.get(requestId);
  if (!entry) throw new Error(`async request ${requestId} disappeared from the store`);
  if (entry.status === 'complete' || entry.status === 'failed') return entry;
  if (attempts <= 0) throw new Error(`async request stuck in "${entry.status}"`);
  await Bun.sleep(5);
  return drainAsync(store, requestId, attempts - 1);
}

// =============================================================================
// Tests
// =============================================================================
describe('handleEndpointRequest', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  test('returns 404 for unknown endpoint ID', async () => {
    const deps = makeDeps();
    const response = await handleEndpointRequest(makeRequest(), UNKNOWN_ENDPOINT_ID, {}, deps);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe('Endpoint not found');
  });

  test('returns 401 for unauthorized request', async () => {
    const resolved = makeResolved({}, { auth: { type: 'apiKey', keys: ['secret'] } as ClientAuth });
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const deps = makeDeps({ endpointMap });

    const response = await handleEndpointRequest(makeRequest(), endpointId, {}, deps);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe('Missing X-Api-Key header');
  });

  test('returns signed response with encoding', async () => {
    mockFetchResponse({ result: 42 });
    const resolved = makeResolved({}, { encoding: { type: 'int256', path: '$.result', times: '1000000' } });
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const deps = makeDeps({ endpointMap });

    const response = await handleEndpointRequest(makeRequest(), endpointId, { coin: 'ETH' }, deps);
    const body = (await response.json()) as SignedResponseBody;

    expect(response.status).toBe(200);
    expect(body.airnode).toBe(TEST_AIRNODE);
    expect(body.endpointId).toBe(endpointId);
    expect(typeof body.timestamp).toBe('number');
    expect(body.data).toMatch(/^0x/);
    expect(body.signature).toMatch(/^0x/);
  });

  test('returns raw response without encoding', async () => {
    mockFetchResponse({ price: 3000 });
    const resolved = makeResolved();
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const deps = makeDeps({ endpointMap });

    const response = await handleEndpointRequest(makeRequest(), endpointId, {}, deps);
    const body = (await response.json()) as RawResponseBody;

    expect(response.status).toBe(200);
    expect(body.airnode).toBe(TEST_AIRNODE);
    expect(body.endpointId).toBe(endpointId);
    expect(typeof body.timestamp).toBe('number');
    expect(body.rawData).toEqual({ price: 3000 });
    expect(body.signature).toMatch(/^0x/);
  });

  test('returns cached response on second call', async () => {
    mockFetchResponse({ price: 3000 });
    const resolved = makeResolved({}, { cache: { maxAge: 60_000 } });
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const cache = createCache();
    const deps = makeDeps({ endpointMap, cache });

    // First call — hits the API
    const response1 = await handleEndpointRequest(makeRequest(), endpointId, { coin: 'ETH' }, deps);
    expect(response1.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second call — should use cache
    const response2 = await handleEndpointRequest(makeRequest(), endpointId, { coin: 'ETH' }, deps);
    expect(response2.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const body1 = (await response1.json()) as RawResponseBody;
    const body2 = (await response2.json()) as RawResponseBody;
    expect(body2.rawData).toEqual(body1.rawData);
  });

  test('streaming endpoint returns an SSE frame carrying the signed result', async () => {
    mockFetchResponse({ price: 3000 });
    const resolved = makeResolved({}, { mode: 'stream', encoding: { type: 'int256', path: '$.price' } });
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const deps = makeDeps({ endpointMap });

    const response = await handleEndpointRequest(makeRequest(), endpointId, {}, deps);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    const text = await response.text();
    expect(text.startsWith('data: ')).toBe(true);
    const payload = JSON.parse(text.slice('data: '.length).trim()) as { done: boolean; signature: string };
    expect(payload.done).toBe(true);
    expect(payload.signature).toMatch(/^0x/);
  });

  test('streaming endpoint propagates a pipeline error as a plain JSON response', async () => {
    fetchMock.mockResolvedValue({ text: () => Promise.resolve(''), status: 204 });
    const resolved = makeResolved({}, { mode: 'stream', encoding: { type: 'int256', path: '$.price' } });
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const deps = makeDeps({ endpointMap });

    const response = await handleEndpointRequest(makeRequest(), endpointId, {}, deps);

    expect(response.status).toBe(502);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('API returned no data to encode');
  });

  test('async endpoint returns 202 with a requestId and pollUrl', async () => {
    mockFetchResponse({ price: 3000 });
    const resolved = makeResolved({}, { mode: 'async', encoding: { type: 'int256', path: '$.price' } });
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const asyncStore = createAsyncRequestStore();
    const deps = makeDeps({ endpointMap, asyncStore });

    const response = await handleEndpointRequest(makeRequest(), endpointId, {}, deps);

    expect(response.status).toBe(202);
    const body = (await response.json()) as { requestId: string; status: string; pollUrl: string };
    expect(body.status).toBe('pending');
    expect(body.requestId).toMatch(/^0x[\da-f]{64}$/);
    expect(body.pollUrl).toContain(body.requestId);
    asyncStore.stop();
  });

  test('async endpoint runs the pipeline in the background and stores the signed result', async () => {
    mockFetchResponse({ price: 3000 });
    const resolved = makeResolved({}, { mode: 'async', encoding: { type: 'int256', path: '$.price' } });
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const asyncStore = createAsyncRequestStore();
    const deps = makeDeps({ endpointMap, asyncStore });

    const response = await handleEndpointRequest(makeRequest(), endpointId, {}, deps);
    const { requestId } = (await response.json()) as { requestId: Hex };

    const finished = await drainAsync(asyncStore, requestId);
    expect(finished.status).toBe('complete');
    expect(finished.error).toBeUndefined();
    const result = finished.result as SignedResponseBody;
    expect(result.endpointId).toBe(endpointId);
    expect(result.airnode).toBe(TEST_AIRNODE);
    // int256(3000) — the encoded upstream `price`.
    expect(result.data).toBe('0x0000000000000000000000000000000000000000000000000000000000000bb8');
    expect(result.signature).toMatch(/^0x[\da-f]+$/);
    asyncStore.stop();
  });

  test('async endpoint records a failed state when the upstream call fails', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'));
    const resolved = makeResolved({}, { mode: 'async', encoding: { type: 'int256', path: '$.price' } });
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const asyncStore = createAsyncRequestStore();
    const deps = makeDeps({ endpointMap, asyncStore });

    const response = await handleEndpointRequest(makeRequest(), endpointId, {}, deps);
    const { requestId } = (await response.json()) as { requestId: Hex };

    const finished = await drainAsync(asyncStore, requestId);
    expect(finished.status).toBe('failed');
    expect(finished.error).toBe('API call returned an error');
    expect(finished.result).toBeUndefined();
    asyncStore.stop();
  });

  test('correct response structure for signed response', async () => {
    mockFetchResponse({ result: 100 });
    const resolved = makeResolved({}, { encoding: { type: 'int256', path: '$.result' } });
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const deps = makeDeps({ endpointMap });

    const response = await handleEndpointRequest(makeRequest(), endpointId, {}, deps);
    const body = (await response.json()) as SignedResponseBody;

    expect(Object.keys(body).toSorted()).toEqual(['airnode', 'data', 'endpointId', 'signature', 'timestamp']);
  });

  test('correct response structure for raw response', async () => {
    mockFetchResponse({ value: 'hello' });
    const resolved = makeResolved();
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const deps = makeDeps({ endpointMap });

    const response = await handleEndpointRequest(makeRequest(), endpointId, {}, deps);
    const body = (await response.json()) as RawResponseBody;

    expect(Object.keys(body).toSorted()).toEqual(['airnode', 'endpointId', 'rawData', 'signature', 'timestamp']);
  });

  test('returns 400 for missing required parameters', async () => {
    const resolved = makeResolved(
      {},
      {
        parameters: [
          { name: 'coinId', in: 'query', required: true, secret: false },
          { name: 'currency', in: 'query', required: false, secret: false, default: 'usd' },
        ],
      }
    );
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const deps = makeDeps({ endpointMap });

    const response = await handleEndpointRequest(makeRequest(), endpointId, {}, deps);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain('coinId');
  });

  test('passes validation when required parameter has fixed value', async () => {
    mockFetchResponse({ price: 3000 });
    const resolved = makeResolved(
      {},
      {
        parameters: [{ name: 'apiVersion', in: 'query', required: true, secret: false, fixed: 'v2' }],
      }
    );
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const deps = makeDeps({ endpointMap });

    const response = await handleEndpointRequest(makeRequest(), endpointId, {}, deps);
    expect(response.status).toBe(200);
  });

  test('authenticated request with valid API key succeeds', async () => {
    mockFetchResponse({ price: 3000 });
    const resolved = makeResolved({}, { auth: { type: 'apiKey', keys: ['my-key'] } as ClientAuth });
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const deps = makeDeps({ endpointMap });

    const response = await handleEndpointRequest(makeRequest({ 'X-Api-Key': 'my-key' }), endpointId, {}, deps);

    expect(response.status).toBe(200);
  });

  // ===========================================================================
  // Requester-specified encoding (operator opts in via `*` wildcards)
  // ===========================================================================
  test('encodes response when operator wildcards type+path and client supplies them', async () => {
    mockFetchResponse({ result: 42 });
    const resolved = makeResolved({}, { encoding: { type: '*', path: '*' } });
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const deps = makeDeps({ endpointMap });

    const response = await handleEndpointRequest(
      makeRequest(),
      endpointId,
      { _type: 'int256', _path: '$.result' },
      deps
    );
    const body = (await response.json()) as SignedResponseBody;

    expect(response.status).toBe(200);
    expect(body.data).toBe('0x000000000000000000000000000000000000000000000000000000000000002a');
    expect(body.signature).toMatch(/^0x/);
    expect('rawData' in body).toBe(false);
  });

  test('applies _times multiplier when operator wildcards times', async () => {
    mockFetchResponse({ result: 1.5 });
    const resolved = makeResolved({}, { encoding: { type: '*', path: '*', times: '*' } });
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const deps = makeDeps({ endpointMap });

    const response = await handleEndpointRequest(
      makeRequest(),
      endpointId,
      { _type: 'int256', _path: '$.result', _times: '1000' },
      deps
    );
    const body = (await response.json()) as SignedResponseBody;

    expect(response.status).toBe(200);
    // 1.5 * 1000 = 1500, int256-encoded
    expect(body.data).toBe('0x00000000000000000000000000000000000000000000000000000000000005dc');
  });

  test('returns 400 when a wildcard reserved param is missing from the request', async () => {
    mockFetchResponse({ result: 42 });
    const resolved = makeResolved({}, { encoding: { type: '*', path: '*' } });
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const deps = makeDeps({ endpointMap });

    const response = await handleEndpointRequest(makeRequest(), endpointId, { _type: 'int256' }, deps);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain('_path');
  });

  test('ignores a non-string reserved encoding parameter (treated as missing → 400)', async () => {
    mockFetchResponse({ result: 42 });
    const resolved = makeResolved({}, { encoding: { type: '*', path: '*' } });
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const deps = makeDeps({ endpointMap });

    // A client could send `_type` as a non-string. It must be treated as absent
    // rather than passed to processResponse, which would `.split()` and crash.
    const params = { _type: { evil: 1 }, _path: '$.result' } as unknown as Record<string, string>;
    const response = await handleEndpointRequest(makeRequest(), endpointId, params, deps);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain('_type');
  });

  test('no encoding block: client reserved params are ignored, returns raw JSON', async () => {
    mockFetchResponse({ result: 42 });
    const resolved = makeResolved(); // no encoding block at all
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const deps = makeDeps({ endpointMap });

    // Client tries to synthesize encoding — must be ignored (raw mode wins)
    const response = await handleEndpointRequest(
      makeRequest(),
      endpointId,
      { _type: 'int256', _path: '$.result' },
      deps
    );
    const body = (await response.json()) as RawResponseBody;

    expect(response.status).toBe(200);
    expect(body.rawData).toEqual({ result: 42 });
  });

  test('operator-fixed encoding takes precedence over request params', async () => {
    mockFetchResponse({ result: 42, other: 99 });
    const resolved = makeResolved({}, { encoding: { type: 'int256', path: '$.result' } });
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const deps = makeDeps({ endpointMap });

    // Client tries to override with _path pointing to $.other — should be ignored
    const response = await handleEndpointRequest(
      makeRequest(),
      endpointId,
      {
        _type: 'uint256',
        _path: '$.other',
      },
      deps
    );
    const body = (await response.json()) as SignedResponseBody;

    expect(response.status).toBe(200);
    // int256(42) from $.result — the operator's encoding, NOT uint256(99) from $.other
    expect(body.data).toBe('0x000000000000000000000000000000000000000000000000000000000000002a');
    expect(body.data).not.toBe('0x0000000000000000000000000000000000000000000000000000000000000063');
  });

  test('returns raw response when no encoding and no reserved params', async () => {
    mockFetchResponse({ price: 3000 });
    const resolved = makeResolved();
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const deps = makeDeps({ endpointMap });

    const response = await handleEndpointRequest(makeRequest(), endpointId, {}, deps);
    const body = (await response.json()) as RawResponseBody;

    expect(response.status).toBe(200);
    expect(body.rawData).toEqual({ price: 3000 });
  });

  test('wildcard path: operator pins type, requester provides _path', async () => {
    mockFetchResponse({ result: 42, other: 99 });
    // Operator pins type, wildcards path — requester chooses what to extract
    const resolved = makeResolved({}, { encoding: { type: 'int256', path: '*' } });
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const deps = makeDeps({ endpointMap });

    const response = await handleEndpointRequest(makeRequest(), endpointId, { _path: '$.result' }, deps);
    const body = (await response.json()) as SignedResponseBody;

    expect(response.status).toBe(200);
    expect(body.data).toBe('0x000000000000000000000000000000000000000000000000000000000000002a');
  });

  test('wildcard path: returns 400 when client omits the required _path', async () => {
    mockFetchResponse({ result: 42 });
    const resolved = makeResolved({}, { encoding: { type: 'int256', path: '*' } });
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const deps = makeDeps({ endpointMap });

    const response = await handleEndpointRequest(makeRequest(), endpointId, {}, deps);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain('_path');
  });

  // ===========================================================================
  // Empty / 204 responses
  // ===========================================================================
  test('empty upstream response returns signed null in raw mode', async () => {
    fetchMock.mockResolvedValue({ text: () => Promise.resolve(''), status: 204 });
    const resolved = makeResolved(); // no encoding — raw mode
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const deps = makeDeps({ endpointMap });

    const response = await handleEndpointRequest(makeRequest(), endpointId, {}, deps);
    const body = (await response.json()) as RawResponseBody;

    expect(response.status).toBe(200);
    expect(body.rawData).toBeNull();
    expect(body.signature).toMatch(/^0x/);
  });

  test('empty upstream response with encoding returns 502', async () => {
    fetchMock.mockResolvedValue({ text: () => Promise.resolve(''), status: 204 });
    const resolved = makeResolved({}, { encoding: { type: 'int256', path: '$.price' } });
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const deps = makeDeps({ endpointMap });

    const response = await handleEndpointRequest(makeRequest(), endpointId, {}, deps);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(502);
    expect(body.error).toBe('API returned no data to encode');
  });

  test('returns 503 when the upstream-call concurrency cap is saturated', async () => {
    const sem = createSemaphore(1);
    const held = await sem.acquire(1000); // hold the only slot
    if (!held) throw new Error('expected a slot');

    // The endpoint's API timeout doubles as the semaphore-acquire deadline; keep it short.
    const resolved = makeResolved({ timeout: 40 }, { encoding: { type: 'int256', path: '$.price' } });
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const deps = makeDeps({ endpointMap, apiCallSemaphore: sem });

    const response = await handleEndpointRequest(makeRequest(), endpointId, {}, deps);
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: string }).error).toBe(
      'Server busy — too many upstream calls in flight'
    );
    expect(fetchMock).not.toHaveBeenCalled(); // never reached the upstream

    held();
  });
});

// =============================================================================
// FHE encryption
// =============================================================================
const ENCRYPT_ENDPOINT: Partial<Endpoint> = {
  encoding: { type: 'int256', path: '$.price' },
  encrypt: { type: 'euint256', contract: '0x5FbDB2315678afecb367f032d93F642f64180aa3' },
};

describe('handleEndpointRequest — FHE encryption', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  test('replaces the encoded value with an FHE ciphertext before signing', async () => {
    mockFetchResponse({ price: 3000 });
    const resolved = makeResolved({}, ENCRYPT_ENDPOINT);
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const deps = makeDeps({ endpointMap, settings: FHE_SETTINGS });

    const response = await handleEndpointRequest(makeRequest(), endpointId, {}, deps);
    const body = (await response.json()) as SignedResponseBody;

    expect(response.status).toBe(200);
    expect(body.data).toBe(EXPECTED_CIPHERTEXT);
    expect(body.signature).toMatch(/^0x/);
  });

  test('returns 502 when encryption fails (negative value cannot be encrypted)', async () => {
    mockFetchResponse({ price: -1 });
    const resolved = makeResolved({}, ENCRYPT_ENDPOINT);
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const deps = makeDeps({ endpointMap, settings: FHE_SETTINGS });

    const response = await handleEndpointRequest(makeRequest(), endpointId, {}, deps);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(502);
    expect(body.error).toBe('FHE encryption failed');
  });

  test('returns 502 when an encrypt endpoint runs without fhe configured', async () => {
    mockFetchResponse({ price: 3000 });
    const resolved = makeResolved({}, ENCRYPT_ENDPOINT);
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const deps = makeDeps({ endpointMap }); // settings.fhe === 'none'

    const response = await handleEndpointRequest(makeRequest(), endpointId, {}, deps);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(502);
    expect(body.error).toBe('FHE encryption failed');
  });
});

// =============================================================================
// TLS proof attachment (fetchProofIfEnabled)
// =============================================================================
describe('handleEndpointRequest — TLS proof', () => {
  const GATEWAY_URL = 'https://proof-gateway.example.com/v1/prove';
  const ATTESTOR = '0x0000000000000000000000000000000000000002';
  const PROOF_SETTINGS = {
    timeout: 10_000,
    maxConcurrentApiCalls: 50,
    proof: { type: 'reclaim' as const, gatewayUrl: GATEWAY_URL, timeout: 5000 },
    fhe: 'none' as const,
    plugins: [],
  };

  beforeEach(() => {
    fetchMock.mockReset();
  });

  function routeFetch(gatewayResponse: {
    ok: boolean;
    json?: () => Promise<unknown>;
    text?: () => Promise<string>;
  }): void {
    fetchMock.mockImplementation((input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === GATEWAY_URL) return Promise.resolve(gatewayResponse);
      return Promise.resolve({ text: () => Promise.resolve(JSON.stringify({ price: 3000 })), status: 200 });
    });
  }

  test('attaches a gateway proof when proof is enabled and the endpoint has responseMatches', async () => {
    routeFetch({
      ok: true,
      json: () =>
        Promise.resolve({
          claim: { parameters: JSON.stringify({ url: 'https://api.example.com/data', method: 'GET' }) },
          signatures: { attestorAddress: ATTESTOR, claimSignature: `0x${'ab'.repeat(65)}` },
        }),
    });
    const resolved = makeResolved(
      {},
      { encoding: { type: 'int256', path: '$.price' }, responseMatches: [{ type: 'regex', value: 'price' }] }
    );
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const deps = makeDeps({ endpointMap, settings: PROOF_SETTINGS });

    const response = await handleEndpointRequest(makeRequest(), endpointId, {}, deps);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: string;
      signature: string;
      proof?: { signatures: { attestorAddress: string } };
    };
    expect(body.data).toBe('0x0000000000000000000000000000000000000000000000000000000000000bb8'); // int256(3000)
    expect(body.signature).toMatch(/^0x/);
    expect(body.proof?.signatures.attestorAddress).toBe(ATTESTOR);
  });

  test('returns 200 without a proof when the gateway fails (proof is non-fatal)', async () => {
    routeFetch({ ok: false, text: () => Promise.resolve('gateway down') });
    const resolved = makeResolved(
      {},
      { encoding: { type: 'int256', path: '$.price' }, responseMatches: [{ type: 'regex', value: 'price' }] }
    );
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const deps = makeDeps({ endpointMap, settings: PROOF_SETTINGS });

    const response = await handleEndpointRequest(makeRequest(), endpointId, {}, deps);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { signature: string; proof?: unknown };
    expect(body.signature).toMatch(/^0x/);
    expect(body.proof).toBeUndefined();
  });

  test('skips the gateway entirely when the endpoint has no responseMatches', async () => {
    routeFetch({ ok: false, text: () => Promise.resolve('should not be called') });
    const resolved = makeResolved({}, { encoding: { type: 'int256', path: '$.price' } }); // no responseMatches
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const deps = makeDeps({ endpointMap, settings: PROOF_SETTINGS });

    const response = await handleEndpointRequest(makeRequest(), endpointId, {}, deps);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { proof?: unknown };
    expect(body.proof).toBeUndefined();
    // The mock was hit once (the upstream API call), not twice (no gateway call).
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
