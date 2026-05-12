import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestServer } from '../helpers';
import type { TestContext } from '../helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestServer({ server: { rateLimit: { window: 60_000, max: 3, trustForwardedFor: false } } });
});

afterAll(() => {
  ctx.stop();
});

describe('S8 — Rate limiting', () => {
  test('requests within limit succeed, then 429', async () => {
    const healthUrl = `${ctx.baseUrl}/health`;

    const r1 = await fetch(healthUrl);
    expect(r1.status).toBe(200);

    const r2 = await fetch(healthUrl);
    expect(r2.status).toBe(200);

    const r3 = await fetch(healthUrl);
    expect(r3.status).toBe(200);

    const r4 = await fetch(healthUrl);
    expect(r4.status).toBe(429);

    const body = (await r4.json()) as { error: string };
    expect(body.error).toBe('Too Many Requests');
  });
});
