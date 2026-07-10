import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { CLIENT_API_KEY, createTestServer, findEndpointId, post, setMockResponse } from '../helpers';
import type { TestContext } from '../helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestServer();
});

afterAll(() => {
  ctx.stop();
});

describe('S37 — Upstream error status handling', () => {
  test('upstream 500 with valid shape is not signed', async () => {
    await setMockResponse('/simple/price', { ethereum: { usd: 0 } }, 500);

    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPrice');
    const response = await post(ctx.baseUrl, endpointId, { ids: 'ethereum' }, { 'X-Api-Key': CLIENT_API_KEY });
    const body = (await response.json()) as { error: string; data?: string; signature?: string };

    expect(response.status).toBe(502);
    expect(body.error).toBe('Upstream API returned an error');
    expect(body.data).toBeUndefined();
    expect(body.signature).toBeUndefined();
  });

  test('upstream 500 with wrong shape returns 502', async () => {
    await setMockResponse('/current.json', { error: 'internal server error' }, 500);

    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    const response = await post(ctx.baseUrl, endpointId, { q: 'London' });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(502);
    expect(body.error).toBe('Upstream API returned an error');
  });
});
