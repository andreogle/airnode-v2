import type { Hex } from 'viem';
import { createCache } from '../src/cache';
import type { ResponseCache } from '../src/cache';
import { loadEnvFile } from '../src/config/env';
import { parseConfig } from '../src/config/parser';
import { buildEndpointMap } from '../src/endpoint';
import type { ResolvedEndpoint } from '../src/endpoint';
import { handleEndpointRequest } from '../src/pipeline';
import { createEmptyRegistry } from '../src/plugins';
import type { PluginRegistry } from '../src/plugins';
import { createServer } from '../src/server';
import type { ServerHandle } from '../src/server';
import { createAirnodeAccount } from '../src/sign';
import type { Api, Config } from '../src/types';

const CONFIG_PATH = `${import.meta.dirname}/../examples/configs/complete/config.yaml`;
const ENV_PATH = `${import.meta.dirname}/../examples/configs/complete/.env.example`;
const PRIVATE_KEY: Hex = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const AIRNODE_ADDRESS: Hex = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const CLIENT_API_KEY = 'test-client-key';
const MOCK_API_PORT = process.env['MOCK_API_PORT'] ?? '5123';
const MOCK_API_URL = `http://127.0.0.1:${MOCK_API_PORT}`;

// =============================================================================
// Test server
// =============================================================================
interface TestContext {
  readonly config: Config;
  readonly server: ServerHandle;
  readonly cache: ResponseCache;
  readonly endpointMap: ReadonlyMap<Hex, ResolvedEndpoint>;
  readonly baseUrl: string;
  readonly stop: () => void;
}

function rewriteApiUrls(apis: readonly Api[]): Api[] {
  return apis.map((api) => ({ ...api, url: MOCK_API_URL }));
}

interface TestServerOptions {
  readonly server?: Partial<Config['server']>;
  readonly plugins?: PluginRegistry;
  readonly apiOverrides?: (apis: readonly Api[]) => Api[];
}

async function createTestServer(options: TestServerOptions = {}): Promise<TestContext> {
  const serverOverrides = options.server ?? {};
  await loadEnvFile(ENV_PATH);

  const account = createAirnodeAccount(PRIVATE_KEY);
  const raw = await Bun.file(CONFIG_PATH).text();
  const parsed = parseConfig(raw);

  const testConfig: Config = {
    ...parsed,
    server: { ...parsed.server, port: 0, rateLimit: undefined, ...serverOverrides },
    settings: { ...parsed.settings, plugins: [] },
    apis: options.apiOverrides ? options.apiOverrides(rewriteApiUrls(parsed.apis)) : rewriteApiUrls(parsed.apis),
  } as Config;

  const endpointMap = buildEndpointMap(testConfig);
  const cache = createCache();

  const server = createServer({
    config: testConfig,
    account,
    airnode: account.address,
    endpointMap,
    plugins: options.plugins ?? createEmptyRegistry(),
    cache,
    handleRequest: handleEndpointRequest,
  });

  return {
    config: testConfig,
    server,
    cache,
    endpointMap,
    baseUrl: `http://127.0.0.1:${String(server.port)}`,
    stop: () => {
      server.stop();
      cache.stop();
    },
  };
}

function findEndpointId(endpointMap: ReadonlyMap<Hex, ResolvedEndpoint>, apiName: string, endpointName: string): Hex {
  const entry = [...endpointMap.entries()].find(
    ([, resolved]) => resolved.api.name === apiName && resolved.endpoint.name === endpointName
  );
  if (!entry) throw new Error(`Endpoint ${apiName}/${endpointName} not found`);
  return entry[0];
}

function post(
  baseUrl: string,
  endpointId: Hex,
  parameters: Record<string, string> = {},
  headers: Record<string, string> = {}
): Promise<Response> {
  return fetch(`${baseUrl}/endpoints/${endpointId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ parameters }),
  });
}

async function setMockResponse(path: string, response: unknown, status = 200): Promise<void> {
  const result = await fetch(`${MOCK_API_URL}/mock/set-response`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, response, status }),
  });
  if (!result.ok) throw new Error(`Failed to set mock response: ${String(result.status)}`);
}

interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

async function getMockCalls(): Promise<readonly RecordedCall[]> {
  const response = await fetch(`${MOCK_API_URL}/mock/calls`);
  if (!response.ok) throw new Error(`Failed to get mock calls: ${String(response.status)}`);
  return (await response.json()) as RecordedCall[];
}

async function resetMock(): Promise<void> {
  const result = await fetch(`${MOCK_API_URL}/mock/reset`, { method: 'POST' });
  if (!result.ok) throw new Error(`Failed to reset mock: ${String(result.status)}`);
}

export {
  AIRNODE_ADDRESS,
  CLIENT_API_KEY,
  MOCK_API_URL,
  createTestServer,
  findEndpointId,
  getMockCalls,
  post,
  resetMock,
  setMockResponse,
};
export type { TestContext };
