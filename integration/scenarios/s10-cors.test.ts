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
  test('GET /health reflects an allow-listed Origin', async () => {
    const response = await fetch(`${ctx.baseUrl}/health`, { headers: { Origin: 'https://app.example.com' } });

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  test('GET /health denies an origin that is not on the allow-list', async () => {
    const response = await fetch(`${ctx.baseUrl}/health`, { headers: { Origin: 'https://evil.example.com' } });

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('null');
  });

  test('OPTIONS returns 204 with correct CORS headers', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');

    const response = await fetch(`${ctx.baseUrl}/endpoints/${endpointId}`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://app.example.com' },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
      'Content-Type, X-Api-Key, Authorization, X-Payment-Proof'
    );
    expect(response.headers.get('Access-Control-Max-Age')).toBe('86400');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
  });
});
