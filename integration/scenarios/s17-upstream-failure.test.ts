import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createTestServer, findEndpointId, post, resetMock, setMockResponse } from '../helpers';
import type { TestContext } from '../helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestServer();
});

afterAll(() => {
  ctx.stop();
});
beforeEach(() => resetMock());

describe('S17 — Upstream API failure handling', () => {
  test('upstream returning wrong shape returns 502', async () => {
    await setMockResponse('/current.json', { completely: { wrong: 'shape' } });

    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    const response = await post(ctx.baseUrl, endpointId, { q: 'London' });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(502);
    expect(body.error).toBe('Internal processing error');
  });

  test('upstream returning non-JSON returns 502', async () => {
    // The mock always returns JSON, but we can set a response that the Airnode
    // treats as an error because the encoded data fails processing
    await setMockResponse('/current.json', 'not json', 200);

    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    const response = await post(ctx.baseUrl, endpointId, { q: 'Berlin' });

    expect(response.status).toBe(502);
  });

  test('error details are not leaked to the client', async () => {
    await setMockResponse('/current.json', { bad: 'data' });

    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    const response = await post(ctx.baseUrl, endpointId, { q: 'Paris' });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(502);
    expect(body.error).not.toContain('$.');
    expect(body.error).not.toContain('stack');
    expect(body.error).not.toContain('temp_c');
  });
});
