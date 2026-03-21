import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Hex } from 'viem';
import { createTestServer, findEndpointId, post } from '../helpers';
import type { TestContext } from '../helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestServer({
    apiOverrides: (apis) =>
      apis.map((api) =>
        api.name === 'WeatherAPI'
          ? {
              ...api,
              endpoints: api.endpoints.map((ep) =>
                ep.name === 'currentTemp' ? { ...ep, mode: 'async' as const } : ep
              ),
            }
          : api
      ),
  });
});

afterAll(() => {
  ctx.stop();
});

describe('S33 — Async request lifecycle', () => {
  test('POST returns 202 with requestId and pollUrl', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    const response = await post(ctx.baseUrl, endpointId, { q: 'London' });

    const body = (await response.json()) as { requestId: string; status: string; pollUrl: string };

    expect(response.status).toBe(202);
    expect(body.requestId).toMatch(/^0x[\da-f]{64}$/);
    expect(body.status).toBe('pending');
    expect(body.pollUrl).toContain('/requests/');
  });

  test('polling returns complete with signed data', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    const response = await post(ctx.baseUrl, endpointId, { q: 'London' });
    const { pollUrl } = (await response.json()) as { pollUrl: string };

    // Wait for background processing
    await Bun.sleep(200);

    const pollResponse = await fetch(`${ctx.baseUrl}${pollUrl}`);
    const pollBody = (await pollResponse.json()) as {
      status: string;
      data: Hex;
      signature: Hex;
    };

    expect(pollResponse.status).toBe(200);
    expect(pollBody.status).toBe('complete');
    expect(pollBody.data).toMatch(/^0x/);
    expect(pollBody.signature).toMatch(/^0x/);
  });

  test('polling non-existent requestId returns 404', async () => {
    const fakeId = `0x${'00'.repeat(32)}`;
    const response = await fetch(`${ctx.baseUrl}/requests/${fakeId}`);
    expect(response.status).toBe(404);
  });
});
