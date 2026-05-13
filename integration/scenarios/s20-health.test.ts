import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { AIRNODE_ADDRESS, createTestServer } from '../helpers';
import type { TestContext } from '../helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestServer();
});

afterAll(() => {
  ctx.stop();
});

describe('S20 — Health endpoint', () => {
  test('returns status and the airnode address (no version field)', async () => {
    const response = await fetch(`${ctx.baseUrl}/health`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: 'ok', airnode: AIRNODE_ADDRESS });
  });

  test('returns 404 for unknown routes', async () => {
    const response = await fetch(`${ctx.baseUrl}/unknown`);
    expect(response.status).toBe(404);
  });

  test('returns 405 for non-POST to /endpoints/{id}', async () => {
    const response = await fetch(
      `${ctx.baseUrl}/endpoints/0x0000000000000000000000000000000000000000000000000000000000000001`
    );
    expect(response.status).toBe(405);
  });
});
