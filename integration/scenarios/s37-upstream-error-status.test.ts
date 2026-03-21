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
  test('upstream 500 with valid shape encodes and signs the data', async () => {
    // The upstream returns a 500 but with a JSON body that matches the expected shape.
    // callApi does not throw on non-200 — it returns the parsed JSON. The pipeline
    // encodes and signs it. This documents the current behavior.
    await setMockResponse('/simple/price', { ethereum: { usd: 0 } }, 500);

    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPrice');
    const response = await post(ctx.baseUrl, endpointId, { ids: 'ethereum' }, { 'X-Api-Key': CLIENT_API_KEY });
    const body = (await response.json()) as { data: string; signature: string };

    // Current behavior: the response is encoded and signed even though upstream returned 500
    expect(response.status).toBe(200);
    expect(body.data).toMatch(/^0x/);
    expect(body.signature).toMatch(/^0x/);
  });

  test('upstream 500 with wrong shape returns 502', async () => {
    await setMockResponse('/current.json', { error: 'internal server error' }, 500);

    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    const response = await post(ctx.baseUrl, endpointId, { q: 'London' });
    const body = (await response.json()) as { error: string };

    // Encoding fails because path $.current.temp_c doesn't exist in error response
    expect(response.status).toBe(502);
    expect(body.error).toBe('Internal processing error');
  });
});
