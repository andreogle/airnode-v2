import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Hex } from 'viem';
import { createCache } from './cache';
import { deriveEndpointId } from './endpoint';
import type { ResolvedEndpoint } from './endpoint';
import { handleEndpointRequest } from './pipeline';
import type { PipelineDependencies, RawResponseBody, SignedResponseBody } from './pipeline';
import { createEmptyRegistry } from './plugins';
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
    settings: { timeout: 10_000, proof: 'none', plugins: [] },
    ...overrides,
  };
}

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://test/endpoints/0x00', { headers });
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
  // Requester-specified encoding
  // ===========================================================================
  test('encodes response when client sends _type and _path', async () => {
    mockFetchResponse({ result: 42 });
    const resolved = makeResolved(); // no encoding block
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const deps = makeDeps({ endpointMap });

    const response = await handleEndpointRequest(
      makeRequest(),
      endpointId,
      {
        _type: 'int256',
        _path: '$.result',
      },
      deps
    );
    const body = (await response.json()) as SignedResponseBody;

    expect(response.status).toBe(200);
    expect(body.data).toMatch(/^0x/);
    expect(body.signature).toMatch(/^0x/);
    // Should NOT have rawData — it's an encoded response
    expect('rawData' in body).toBe(false);
  });

  test('applies _times multiplier from request params', async () => {
    mockFetchResponse({ result: 1.5 });
    const resolved = makeResolved();
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const deps = makeDeps({ endpointMap });

    const response = await handleEndpointRequest(
      makeRequest(),
      endpointId,
      {
        _type: 'int256',
        _path: '$.result',
        _times: '1000',
      },
      deps
    );
    const body = (await response.json()) as SignedResponseBody;

    expect(response.status).toBe(200);
    expect(body.data).toMatch(/^0x/);
  });

  test('returns 400 when _type is provided without _path', async () => {
    mockFetchResponse({ result: 42 });
    const resolved = makeResolved();
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const deps = makeDeps({ endpointMap });

    const response = await handleEndpointRequest(makeRequest(), endpointId, { _type: 'int256' }, deps);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain('_type');
    expect(body.error).toContain('_path');
  });

  test('returns 400 when _path is provided without _type', async () => {
    mockFetchResponse({ result: 42 });
    const resolved = makeResolved();
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const deps = makeDeps({ endpointMap });

    const response = await handleEndpointRequest(makeRequest(), endpointId, { _path: '$.result' }, deps);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain('_type');
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
    expect(body.data).toMatch(/^0x/);
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

  test('partial encoding: operator sets type, requester provides _path', async () => {
    mockFetchResponse({ result: 42, other: 99 });
    // Operator fixes type but not path — requester chooses what to extract
    const resolved = makeResolved({}, { encoding: { type: 'int256' } });
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const deps = makeDeps({ endpointMap });

    const response = await handleEndpointRequest(makeRequest(), endpointId, { _path: '$.result' }, deps);
    const body = (await response.json()) as SignedResponseBody;

    expect(response.status).toBe(200);
    expect(body.data).toMatch(/^0x/);
  });

  test('partial encoding: returns 400 when merged result is incomplete', async () => {
    mockFetchResponse({ result: 42 });
    // Operator sets only times — neither type nor path
    const resolved = makeResolved({}, { encoding: { times: '1000' } });
    const endpointMap = makeEndpointMap(resolved);
    const endpointId = [...endpointMap.keys()][0] as Hex;
    const deps = makeDeps({ endpointMap });

    const response = await handleEndpointRequest(makeRequest(), endpointId, { _type: 'int256' }, deps);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain('_type');
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
});
