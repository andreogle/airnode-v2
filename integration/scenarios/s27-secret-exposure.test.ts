import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { CLIENT_API_KEY, createTestServer, findEndpointId, post } from '../helpers';
import type { TestContext } from '../helpers';

let ctx: TestContext;

const infoMock = mock();
const warnMock = mock();
const errorMock = mock();
const originalInfo = console.info;
const originalWarn = console.warn;
const originalError = console.error;

beforeAll(async () => {
  ctx = await createTestServer();
});

afterAll(() => {
  ctx.stop();
  console.info = originalInfo;
  console.warn = originalWarn;
  console.error = originalError;
});

beforeEach(() => {
  console.info = infoMock;
  console.warn = warnMock;
  console.error = errorMock;
});

afterEach(() => {
  console.info = originalInfo;
  console.warn = originalWarn;
  console.error = originalError;
  infoMock.mockClear();
  warnMock.mockClear();
  errorMock.mockClear();
});

const PRIVATE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

describe('S27 — Private key security', () => {
  test('private key is not in any log output', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    await post(ctx.baseUrl, endpointId, { q: 'London' });

    const allLogs = [
      ...infoMock.mock.calls.map((c) => String(c[0])),
      ...warnMock.mock.calls.map((c) => String(c[0])),
      ...errorMock.mock.calls.map((c) => String(c[0])),
    ];

    for (const log of allLogs) {
      expect(log).not.toContain(PRIVATE_KEY);
    }
  });

  test('private key is not in any response body', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    const response = await post(ctx.baseUrl, endpointId, { q: 'London' });
    const text = await response.text();

    expect(text).not.toContain(PRIVATE_KEY);
  });

  test('client API key is not in error response body', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPrice');
    const response = await post(ctx.baseUrl, endpointId, { ids: 'ethereum' }, { 'X-Api-Key': 'wrong-key' });
    const text = await response.text();

    expect(response.status).toBe(401);
    expect(text).not.toContain('wrong-key');
  });

  test('upstream API credentials are not in debug log URL', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPrice');
    await post(ctx.baseUrl, endpointId, { ids: 'ripple' }, { 'X-Api-Key': CLIENT_API_KEY });

    const allLogs = infoMock.mock.calls.map((c) => String(c[0]));
    const debugLogs = allLogs.filter((l) => l.includes('Calling'));

    // Debug log should show origin+pathname only, not query params with potential secrets

    for (const log of debugLogs) {
      expect(log).not.toContain('test-coingecko-key');
    }
  });
});
