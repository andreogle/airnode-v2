import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Hex } from 'viem';
import type { Api } from '../../src/types';
import { createTestServer, findEndpointId } from '../helpers';
import type { TestContext } from '../helpers';

let ctx: TestContext;

beforeAll(async () => {
  // Add a streaming endpoint by overriding the WeatherAPI's currentTemp to mode: stream
  ctx = await createTestServer({
    apiOverrides: (apis) =>
      apis.map((api) => {
        if (api.name !== 'WeatherAPI') return api;
        return {
          ...api,
          endpoints: api.endpoints.map((ep) => (ep.name === 'currentTemp' ? { ...ep, mode: 'stream' as const } : ep)),
        } as Api;
      }),
  });
});

afterAll(() => {
  ctx.stop();
});

describe('S31 — SSE streaming', () => {
  test('returns text/event-stream content type', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');

    const response = await fetch(`${ctx.baseUrl}/endpoints/${endpointId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parameters: { q: 'London' } }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
  });

  test('response body is a valid SSE event with done: true', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');

    const response = await fetch(`${ctx.baseUrl}/endpoints/${endpointId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parameters: { q: 'Tokyo' } }),
    });

    const text = await response.text();

    // SSE events are "data: <json>\n\n"
    expect(text).toContain('data: ');
    expect(text).toContain('"done":true');

    // Parse the SSE event
    const jsonStr = text.split('data: ')[1]?.split('\n')[0] ?? '';
    const event = JSON.parse(jsonStr) as { done: boolean; airnode: string; endpointId: string; signature: string };

    expect(event.done).toBe(true);
    expect(event.airnode).toMatch(/^0x/);
    expect(event.endpointId).toBe(endpointId);
    expect(event.signature).toMatch(/^0x/);
  });

  test('signed data in SSE event contains encoded value', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');

    const response = await fetch(`${ctx.baseUrl}/endpoints/${endpointId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parameters: { q: 'Berlin' } }),
    });

    const text = await response.text();
    const jsonStr = text.split('data: ')[1]?.split('\n')[0] ?? '';
    const event = JSON.parse(jsonStr) as { data: Hex; timestamp: number };

    // WeatherAPI currentTemp has encoding — data should be ABI-encoded
    expect(event.data).toMatch(/^0x/);
    expect(typeof event.timestamp).toBe('number');
  });

  test('non-stream endpoint ignores Accept: text/event-stream', async () => {
    // CoinGecko coinPrice is mode: sync (default) — should return normal JSON even with SSE Accept
    const endpointId = findEndpointId(ctx.endpointMap, 'CoinGecko', 'coinPrice');

    const response = await fetch(`${ctx.baseUrl}/endpoints/${endpointId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'X-Api-Key': 'test-client-key',
      },
      body: JSON.stringify({ parameters: { ids: 'bitcoin' } }),
    });

    // Should be normal JSON, not SSE
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(response.status).toBe(200);
  });
});
