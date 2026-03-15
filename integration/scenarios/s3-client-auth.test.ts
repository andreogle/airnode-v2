import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { CLIENT_API_KEY, createTestServer, findEndpointId, post } from '../helpers';
import type { TestContext } from '../helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestServer();
});

afterAll(() => {
  ctx.stop();
});

describe('S3 — Client authentication', () => {
  test('free auth: WeatherAPI succeeds without headers', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    const response = await post(ctx.baseUrl, endpointId, { q: 'London' });

    expect(response.status).toBe(200);
  });

  test('apiKey auth: valid key succeeds', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPrice');
    const response = await post(ctx.baseUrl, endpointId, { ids: 'ethereum' }, { 'X-Api-Key': CLIENT_API_KEY });

    expect(response.status).toBe(200);
  });

  test('apiKey auth: missing header returns 401', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPrice');
    const response = await post(ctx.baseUrl, endpointId, { ids: 'ethereum' });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe('Missing X-Api-Key header');
  });

  test('apiKey auth: invalid key returns 401', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPrice');
    const response = await post(ctx.baseUrl, endpointId, { ids: 'ethereum' }, { 'X-Api-Key': 'wrong-key' });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe('Invalid API key');
  });

  test('API-level auth applies to all endpoints', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPriceRaw');
    const noAuth = await post(ctx.baseUrl, endpointId, { ids: 'ethereum', vs_currencies: 'usd' });
    expect(noAuth.status).toBe(401);

    const withAuth = await post(
      ctx.baseUrl,
      endpointId,
      { ids: 'ethereum', vs_currencies: 'usd' },
      { 'X-Api-Key': CLIENT_API_KEY }
    );
    expect(withAuth.status).toBe(200);
  });

  test('API with no auth configured is accessible without key', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'RandomAPI', 'generateInteger');
    const response = await post(ctx.baseUrl, endpointId, { min: '0', max: '100' });

    expect(response.status).toBe(200);
  });
});
