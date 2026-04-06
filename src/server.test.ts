import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { Hex } from 'viem';
import { createCache } from './cache';
import { createEmptyRegistry } from './plugins';
import { createServer } from './server';
import type { ServerDependencies, ServerHandle } from './server';
import { createAirnodeAccount } from './sign';
import type { Config } from './types';
import { VERSION } from './version';

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
    settings: { timeout: 10_000, proof: 'none', plugins: [] },
  } as Config;
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
    server?.stop();
  });

  test('health endpoint returns status, version, airnode', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    baseUrl = `http://127.0.0.1:${String(server.port)}`;

    const response = await fetch(`${baseUrl}/health`);
    const body = (await response.json()) as { status: string; version: string; airnode: string };

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.version).toBe(VERSION);
    expect(body.airnode).toBe(TEST_AIRNODE);
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

  test('CORS headers are set', async () => {
    const deps = makeDeps({
      config: makeConfig({ cors: { origins: ['https://example.com', 'https://app.example.com'] } }),
    });
    server = createServer(deps);
    baseUrl = `http://127.0.0.1:${String(server.port)}`;

    const response = await fetch(`${baseUrl}/health`);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com, https://app.example.com');
  });

  test('rate limiting returns 429 after max requests', async () => {
    const deps = makeDeps({
      config: makeConfig({ rateLimit: { window: 60_000, max: 3 } }),
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
