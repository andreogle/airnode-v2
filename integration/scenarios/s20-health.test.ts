import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { VERSION } from '../../src/version';
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
  test('returns status, version, and airnode address', async () => {
    const response = await fetch(`${ctx.baseUrl}/health`);
    const body = (await response.json()) as { status: string; version: string; airnode: string };

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.version).toBe(VERSION);
    expect(body.airnode).toBe(AIRNODE_ADDRESS);
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
