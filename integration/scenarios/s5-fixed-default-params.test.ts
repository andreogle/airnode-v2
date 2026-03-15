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

describe('S5 — Fixed and default parameters', () => {
  test('fixed query parameters are sent to the upstream API', async () => {
    // coinMarketData has fixed: localization=false, tickers=false
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinMarketData');
    await post(ctx.baseUrl, endpointId, { coinId: 'bitcoin' }, { 'X-Api-Key': CLIENT_API_KEY });

    const calls = await getMockCalls();
    const lastCall = calls.at(-1);
    const url = new URL(lastCall?.url ?? '');
    expect(url.searchParams.get('localization')).toBe('false');
    expect(url.searchParams.get('tickers')).toBe('false');
  });

  test('fixed parameters cannot be overridden by request body', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinMarketData');
    await post(ctx.baseUrl, endpointId, { coinId: 'bitcoin', localization: 'true' }, { 'X-Api-Key': CLIENT_API_KEY });

    const calls = await getMockCalls();
    const lastCall = calls.at(-1);
    const url = new URL(lastCall?.url ?? '');
    expect(url.searchParams.get('localization')).toBe('false');
  });

  test('default parameters are used when request body omits them', async () => {
    // coinPrice has vs_currencies with default: usd
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPrice');
    await post(ctx.baseUrl, endpointId, { ids: 'ethereum' }, { 'X-Api-Key': CLIENT_API_KEY });

    const calls = await getMockCalls();
    const lastCall = calls.at(-1);
    const url = new URL(lastCall?.url ?? '');
    expect(url.searchParams.get('vs_currencies')).toBe('usd');
  });

  test('default parameters can be overridden by request body', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPrice');
    await post(ctx.baseUrl, endpointId, { ids: 'ethereum', vs_currencies: 'eur' }, { 'X-Api-Key': CLIENT_API_KEY });

    const calls = await getMockCalls();
    const lastCall = calls.at(-1);
    const url = new URL(lastCall?.url ?? '');
    expect(url.searchParams.get('vs_currencies')).toBe('eur');
  });

  test('fixed body parameters are sent to the upstream API', async () => {
    // RandomAPI generateInteger has fixed body: jsonrpc='2.0', method='generateIntegers'
    const endpointId = findEndpointId(ctx.endpointMap, 'RandomAPI', 'generateInteger');
    await post(ctx.baseUrl, endpointId, { min: '1', max: '50' });

    const calls = await getMockCalls();
    const lastCall = calls.at(-1);
    const body = JSON.parse(lastCall?.body ?? '{}') as Record<string, unknown>;
    expect(body.jsonrpc).toBe('2.0');
    expect(body.method).toBe('generateIntegers');
    expect(body.min).toBe('1');
    expect(body.max).toBe('50');
  });

  test('upstream API receives configured headers', async () => {
    // Use unique param to avoid cache hit
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPrice');
    await post(ctx.baseUrl, endpointId, { ids: 'solana' }, { 'X-Api-Key': CLIENT_API_KEY });

    const calls = await getMockCalls();
    const lastCall = calls.at(-1);
    expect(lastCall?.headers['x-cg-pro-api-key']).toBe('test-coingecko-key');
  });

  test('path parameters are substituted in the URL', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinMarketData');
    await post(ctx.baseUrl, endpointId, { coinId: 'ethereum' }, { 'X-Api-Key': CLIENT_API_KEY });

    const calls = await getMockCalls();
    const lastCall = calls.at(-1);
    const url = new URL(lastCall?.url ?? '');
    expect(url.pathname).toBe('/coins/ethereum');
  });
});
