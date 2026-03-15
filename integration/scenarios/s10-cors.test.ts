import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestServer, findEndpointId } from '../helpers';
import type { TestContext } from '../helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestServer({ server: { cors: { origins: ['https://app.example.com'] } } });
});

afterAll(() => {
  ctx.stop();
});

describe('S10 — CORS and preflight', () => {
  test('GET /health includes Access-Control-Allow-Origin', async () => {
    const response = await fetch(`${ctx.baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
  });

  test('OPTIONS returns 204 with correct CORS headers', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');

    const response = await fetch(`${ctx.baseUrl}/endpoints/${endpointId}`, { method: 'OPTIONS' });

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
      'Content-Type, X-Api-Key, Authorization, X-Payment-Proof'
    );
    expect(response.headers.get('Access-Control-Max-Age')).toBe('86400');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
  });
});
