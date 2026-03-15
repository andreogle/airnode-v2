import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestServer, findEndpointId } from '../helpers';
import type { TestContext } from '../helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestServer();
});

afterAll(() => {
  ctx.stop();
});

describe('S9 — Request body security', () => {
  test('body exceeding 64KB returns 413', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    const largeBody = JSON.stringify({ parameters: { q: 'x'.repeat(70_000) } });

    const response = await fetch(`${ctx.baseUrl}/endpoints/${endpointId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: largeBody,
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(413);
    expect(body.error).toContain('too large');
  });

  test('non-JSON content type returns 415', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');

    const response = await fetch(`${ctx.baseUrl}/endpoints/${endpointId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'q=London',
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(415);
    expect(body.error).toContain('application/json');
  });

  test('malformed JSON is treated as empty parameters', async () => {
    // WeatherAPI currentTemp requires `q` — with empty params it should return 400 (missing required)
    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');

    const response = await fetch(`${ctx.baseUrl}/endpoints/${endpointId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid json',
    });

    // Malformed JSON → empty params → missing required param `q` → 400
    expect(response.status).toBe(400);
  });

  test('empty body is treated as empty parameters', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');

    const response = await fetch(`${ctx.baseUrl}/endpoints/${endpointId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    // Empty body → empty params → missing required param `q` → 400
    expect(response.status).toBe(400);
  });
});
