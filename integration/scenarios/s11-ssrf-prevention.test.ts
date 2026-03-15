import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { CLIENT_API_KEY, createTestServer, findEndpointId, getMockCalls, post, resetMock } from '../helpers';
import type { TestContext } from '../helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestServer();
});

afterAll(() => {
  ctx.stop();
});
beforeEach(() => resetMock());

describe('S11 — SSRF prevention', () => {
  test('path traversal attempts are URL-encoded', async () => {
    // coinMarketData uses {coinId} in the path
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinMarketData');
    await post(ctx.baseUrl, endpointId, { coinId: '../../admin' }, { 'X-Api-Key': CLIENT_API_KEY });

    const calls = await getMockCalls();
    const lastCall = calls.at(-1);
    const url = new URL(lastCall?.url ?? 'http://x');

    // encodeURIComponent turns ../../admin into ..%2F..%2Fadmin
    expect(url.pathname).not.toContain('../');
    expect(url.pathname).toContain('%2F');
  });

  test('encoded path stays under the API base origin', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinMarketData');
    await post(ctx.baseUrl, endpointId, { coinId: 'evil.com/steal' }, { 'X-Api-Key': CLIENT_API_KEY });

    // The path is URL-encoded — the mock API receives a safe URL
    const calls = await getMockCalls();
    const lastCall = calls.at(-1);
    const url = new URL(lastCall?.url ?? 'http://x');
    expect(url.hostname).toBe('127.0.0.1');
  });
});
