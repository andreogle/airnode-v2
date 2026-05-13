import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { Hex } from 'viem';
import { createAsyncRequestStore } from './async';
import { createCache } from './cache';
import { createEmptyRegistry } from './plugins';
import { createServer } from './server';
import type { ServerDependencies, ServerHandle } from './server';
import { createAirnodeAccount } from './sign';
import type { Config } from './types';

const TEST_PRIVATE_KEY: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_AIRNODE: Hex = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const TEST_ACCOUNT = createAirnodeAccount(TEST_PRIVATE_KEY);
const TEST_ENDPOINT_ID: Hex = '0x04e77a11d6561a70385e2e8e315989cb24bb35128cb4d5a8b3ece93a3c72295b';
function makeConfig(overrides: Partial<Config['server']> = {}): Config {
  return {
    version: '1.0',
    server: {
      port: 0,
      host: '127.0.0.1',
      cors: { origins: ['*'] },
      rateLimit: { window: 60_000, max: 1_000_000, trustForwardedFor: false }, // effectively unlimited; tests override
      ...overrides,
    },
    apis: [
      {
        name: 'test-api',
        url: 'https://api.example.com',
        timeout: 10_000,
        endpoints: [{ name: 'test', path: '/data', method: 'GET', parameters: [] }],
      },
    ],
    settings: { timeout: 10_000, proof: 'none', fhe: 'none', plugins: [] },
  } as unknown as Config;
}

function makeDeps(overrides: Partial<ServerDependencies> = {}): ServerDependencies {
  const config = overrides.config ?? makeConfig();
  return {
    config,
    account: TEST_ACCOUNT,
    airnode: TEST_AIRNODE,
    endpointMap: new Map(),
    plugins: createEmptyRegistry(),
    cache: createCache(),
    settings: config.settings,
    handleRequest: mock(() => Promise.resolve(Response.json({ ok: true }, { status: 200 }))),
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================
describe('createServer', () => {
  let server: ServerHandle | undefined;

  let baseUrl: string;

  afterEach(() => {
    void server?.stop();
  });

  test('health endpoint returns status and airnode (no version)', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    baseUrl = `http://127.0.0.1:${String(server.port)}`;

    const response = await fetch(`${baseUrl}/health`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: 'ok', airnode: TEST_AIRNODE });
  });

  test('POST to /endpoints/{id} calls handleRequest', async () => {
    const handleRequest = mock(() => Promise.resolve(Response.json({ result: 'ok' }, { status: 200 })));
    const deps = makeDeps({ handleRequest });
    server = createServer(deps);
    baseUrl = `http://127.0.0.1:${String(server.port)}`;

    const response = await fetch(`${baseUrl}/endpoints/${TEST_ENDPOINT_ID}`, {
      method: 'POST',
      body: JSON.stringify({ parameters: { coin: 'ETH' } }),
    });

    expect(response.status).toBe(200);
    expect(handleRequest).toHaveBeenCalledTimes(1);
  });

  test('rejects a request body whose "parameters" is not an object', async () => {
    const handleRequest = mock(() => Promise.resolve(Response.json({ result: 'ok' }, { status: 200 })));
    const deps = makeDeps({ handleRequest });
    server = createServer(deps);
    baseUrl = `http://127.0.0.1:${String(server.port)}`;

    for (const bad of [
      JSON.stringify({ parameters: 5 }),
      JSON.stringify({ parameters: 'str' }),
      JSON.stringify({ parameters: ['a'] }),
      JSON.stringify('not-an-object'),
    ]) {
      const response = await fetch(`${baseUrl}/endpoints/${TEST_ENDPOINT_ID}`, { method: 'POST', body: bad });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain('parameters');
    }
    expect(handleRequest).not.toHaveBeenCalled();
  });

  test('passes nested parameter values through (e.g. for body parameters)', async () => {
    const handleRequest = mock((_req: Request, _id: string, params: Record<string, unknown>) =>
      Promise.resolve(Response.json({ params }, { status: 200 }))
    );
    const deps = makeDeps({ handleRequest: handleRequest as unknown as ServerDependencies['handleRequest'] });
    server = createServer(deps);
    baseUrl = `http://127.0.0.1:${String(server.port)}`;

    const response = await fetch(`${baseUrl}/endpoints/${TEST_ENDPOINT_ID}`, {
      method: 'POST',
      body: JSON.stringify({ parameters: { jsonrpc: '2.0', params: [{ to: '0xabc' }, 'latest'] } }),
    });

    expect(response.status).toBe(200);
    expect(handleRequest).toHaveBeenCalledTimes(1);
    const body = (await response.json()) as { params: Record<string, unknown> };
    expect(body.params).toEqual({ jsonrpc: '2.0', params: [{ to: '0xabc' }, 'latest'] });
  });

  test('treats a missing or null "parameters" as empty', async () => {
    const handleRequest = mock(() => Promise.resolve(Response.json({ result: 'ok' }, { status: 200 })));
    const deps = makeDeps({ handleRequest });
    server = createServer(deps);
    baseUrl = `http://127.0.0.1:${String(server.port)}`;

    const r1 = await fetch(`${baseUrl}/endpoints/${TEST_ENDPOINT_ID}`, { method: 'POST', body: JSON.stringify({}) });
    expect(r1.status).toBe(200);
    const r2 = await fetch(`${baseUrl}/endpoints/${TEST_ENDPOINT_ID}`, { method: 'POST', body: '{"parameters":null}' });
    expect(r2.status).toBe(200);
  });

  test('returns 404 for unknown routes', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    baseUrl = `http://127.0.0.1:${String(server.port)}`;

    const response = await fetch(`${baseUrl}/unknown`);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe('Not Found');
  });

  test('returns 405 for non-POST to /endpoints/{id}', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    baseUrl = `http://127.0.0.1:${String(server.port)}`;

    const response = await fetch(`${baseUrl}/endpoints/${TEST_ENDPOINT_ID}`, { method: 'GET' });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(405);
    expect(body.error).toBe('Method Not Allowed');
  });

  test('rejects a non-JSON Content-Type with 415', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    baseUrl = `http://127.0.0.1:${String(server.port)}`;

    const response = await fetch(`${baseUrl}/endpoints/${TEST_ENDPOINT_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml' },
      body: '<x/>',
    });
    expect(response.status).toBe(415);
    expect(((await response.json()) as { error: string }).error).toBe('Content-Type must be application/json');
  });

  test('rejects an oversized request body with 413', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    baseUrl = `http://127.0.0.1:${String(server.port)}`;

    // 64 KB + 1 byte of JSON-ish payload — over MAX_BODY_BYTES.
    const big = `{"parameters":{"x":"${'a'.repeat(64 * 1024)}"}}`;
    const response = await fetch(`${baseUrl}/endpoints/${TEST_ENDPOINT_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: big,
    });
    expect(response.status).toBe(413);
    expect(((await response.json()) as { error: string }).error).toBe('Request body too large');
  });

  // ===========================================================================
  // Async request polling — GET /requests/{requestId}
  // ===========================================================================
  test('GET /requests/{id} returns the pending status with a pollUrl', async () => {
    const asyncStore = createAsyncRequestStore();
    const deps = makeDeps({ asyncStore });
    server = createServer(deps);
    baseUrl = `http://127.0.0.1:${String(server.port)}`;

    const pending = asyncStore.create(TEST_ENDPOINT_ID);
    if (!pending) throw new Error('expected a pending entry');

    const response = await fetch(`${baseUrl}/requests/${pending.requestId}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { requestId: string; status: string; pollUrl: string };
    expect(body.requestId).toBe(pending.requestId);
    expect(body.status).toBe('pending');
    expect(body.pollUrl).toBe(`/requests/${pending.requestId}`);

    asyncStore.stop();
  });

  test('GET /requests/{id} returns the completed result', async () => {
    const asyncStore = createAsyncRequestStore();
    const deps = makeDeps({ asyncStore });
    server = createServer(deps);
    baseUrl = `http://127.0.0.1:${String(server.port)}`;

    const pending = asyncStore.create(TEST_ENDPOINT_ID);
    if (!pending) throw new Error('expected a pending entry');
    asyncStore.setComplete(pending.requestId, { airnode: TEST_AIRNODE, data: '0xabcd', signature: '0x01' });

    const response = await fetch(`${baseUrl}/requests/${pending.requestId}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { requestId: string; status: string; data: string; signature: string };
    expect(body.status).toBe('complete');
    expect(body.requestId).toBe(pending.requestId);
    expect(body.data).toBe('0xabcd');
    expect(body.signature).toBe('0x01');

    asyncStore.stop();
  });

  test('GET /requests/{id} returns the failed status with an error', async () => {
    const asyncStore = createAsyncRequestStore();
    const deps = makeDeps({ asyncStore });
    server = createServer(deps);
    baseUrl = `http://127.0.0.1:${String(server.port)}`;

    const pending = asyncStore.create(TEST_ENDPOINT_ID);
    if (!pending) throw new Error('expected a pending entry');
    asyncStore.setFailed(pending.requestId, 'API call returned an error');

    const response = await fetch(`${baseUrl}/requests/${pending.requestId}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { requestId: string; status: string; error: string };
    expect(body.status).toBe('failed');
    expect(body.error).toBe('API call returned an error');

    asyncStore.stop();
  });

  test('GET /requests/{id} returns 404 for an unknown request id', async () => {
    const asyncStore = createAsyncRequestStore();
    const deps = makeDeps({ asyncStore });
    server = createServer(deps);
    baseUrl = `http://127.0.0.1:${String(server.port)}`;

    const unknownId = `0x${'00'.repeat(32)}`;
    const response = await fetch(`${baseUrl}/requests/${unknownId}`);
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toBe('Request not found');

    asyncStore.stop();
  });

  test('GET /requests/{badformat} falls through to 404 Not Found', async () => {
    const asyncStore = createAsyncRequestStore();
    const deps = makeDeps({ asyncStore });
    server = createServer(deps);
    baseUrl = `http://127.0.0.1:${String(server.port)}`;

    const response = await fetch(`${baseUrl}/requests/not-a-hex-id`);
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toBe('Not Found');

    asyncStore.stop();
  });

  test('stop() resolves (graceful drain)', async () => {
    const deps = makeDeps();
    const handle = createServer(deps);
    // Should be a promise that settles without throwing.
    await handle.stop();
  });

  test('CORS echoes request Origin when it matches the allow-list', async () => {
    const deps = makeDeps({
      config: makeConfig({ cors: { origins: ['https://example.com', 'https://app.example.com'] } }),
    });
    server = createServer(deps);
    baseUrl = `http://127.0.0.1:${String(server.port)}`;

    const response = await fetch(`${baseUrl}/health`, { headers: { Origin: 'https://app.example.com' } });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  test('CORS returns null origin when request Origin is not allowed', async () => {
    const deps = makeDeps({
      config: makeConfig({ cors: { origins: ['https://app.example.com'] } }),
    });
    server = createServer(deps);
    baseUrl = `http://127.0.0.1:${String(server.port)}`;

    const response = await fetch(`${baseUrl}/health`, { headers: { Origin: 'https://evil.com' } });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('null');
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  test('CORS defaults to wildcard when no allow-list is configured', async () => {
    const deps = makeDeps({ config: makeConfig({}) });
    server = createServer(deps);
    baseUrl = `http://127.0.0.1:${String(server.port)}`;

    const response = await fetch(`${baseUrl}/health`, { headers: { Origin: 'https://anywhere.com' } });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  test('rate limiting returns 429 after max requests', async () => {
    const deps = makeDeps({
      config: makeConfig({ rateLimit: { window: 60_000, max: 3, trustForwardedFor: false } }),
    });
    server = createServer(deps);
    baseUrl = `http://127.0.0.1:${String(server.port)}`;

    // First 3 requests should succeed
    const r1 = await fetch(`${baseUrl}/health`);
    expect(r1.status).toBe(200);
    const r2 = await fetch(`${baseUrl}/health`);
    expect(r2.status).toBe(200);
    const r3 = await fetch(`${baseUrl}/health`);
    expect(r3.status).toBe(200);

    // 4th request should be rate limited
    const r4 = await fetch(`${baseUrl}/health`);
    expect(r4.status).toBe(429);
    const body = (await r4.json()) as { error: string };
    expect(body.error).toBe('Too Many Requests');
  });

  test('rate limiting buckets by X-Forwarded-For when trustForwardedFor is set', async () => {
    const deps = makeDeps({
      config: makeConfig({ rateLimit: { window: 60_000, max: 1, trustForwardedFor: true } }),
    });
    server = createServer(deps);
    baseUrl = `http://127.0.0.1:${String(server.port)}`;
    const get = (xff: string): Promise<Response> => fetch(`${baseUrl}/health`, { headers: { 'X-Forwarded-For': xff } });

    // Each distinct forwarded client gets its own bucket: one request each is allowed.
    const clientA = await get('203.0.113.1');
    expect(clientA.status).toBe(200);
    const clientB = await get('203.0.113.2, 10.0.0.1');
    expect(clientB.status).toBe(200);
    // ...but a second request from the same forwarded client is limited.
    const clientAgain = await get('203.0.113.1');
    expect(clientAgain.status).toBe(429);
  });

  test('rate limiting ignores X-Forwarded-For unless trustForwardedFor is set', async () => {
    const deps = makeDeps({
      config: makeConfig({ rateLimit: { window: 60_000, max: 1, trustForwardedFor: false } }),
    });
    server = createServer(deps);
    baseUrl = `http://127.0.0.1:${String(server.port)}`;
    const get = (xff: string): Promise<Response> => fetch(`${baseUrl}/health`, { headers: { 'X-Forwarded-For': xff } });

    // Both requests share the socket-peer bucket regardless of the spoofed header.
    const first = await get('203.0.113.1');
    expect(first.status).toBe(200);
    const second = await get('203.0.113.2');
    expect(second.status).toBe(429);
  });

  test('OPTIONS preflight returns correct headers', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    baseUrl = `http://127.0.0.1:${String(server.port)}`;

    const response = await fetch(`${baseUrl}/endpoints/${TEST_ENDPOINT_ID}`, { method: 'OPTIONS' });

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
      'Content-Type, X-Api-Key, Authorization, X-Payment-Proof'
    );
  });
});
