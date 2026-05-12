import { afterEach, describe, expect, test } from 'bun:test';
import { createTestServer } from '../helpers';
import type { TestContext } from '../helpers';

// =============================================================================
// S42 — X-Forwarded-For-aware rate limiting
//
// Behind a trusted reverse proxy (`rateLimit.trustForwardedFor: true`) the
// limiter keys on the first X-Forwarded-For entry, so each client gets its own
// bucket. With it off (the default), the header is ignored and everyone shares
// the socket peer's bucket — a proxied deployment that forgot to opt in can't
// be bypassed by spoofing the header.
// =============================================================================
let ctx: TestContext;

afterEach(() => {
  ctx.stop();
});

async function hit(baseUrl: string, forwardedFor: string): Promise<number> {
  const response = await fetch(`${baseUrl}/health`, { headers: { 'X-Forwarded-For': forwardedFor } });
  return response.status;
}

describe('S42 — X-Forwarded-For rate limiting', () => {
  test('with trustForwardedFor on, each forwarded client has an independent bucket', async () => {
    ctx = await createTestServer({ server: { rateLimit: { window: 60_000, max: 3, trustForwardedFor: true } } });

    expect(await hit(ctx.baseUrl, '1.2.3.4')).toBe(200);
    expect(await hit(ctx.baseUrl, '1.2.3.4')).toBe(200);
    expect(await hit(ctx.baseUrl, '1.2.3.4')).toBe(200);
    expect(await hit(ctx.baseUrl, '1.2.3.4')).toBe(429);

    // A different forwarded client is unaffected.
    expect(await hit(ctx.baseUrl, '5.6.7.8')).toBe(200);
    // First entry in a comma-separated list is the originating client.
    expect(await hit(ctx.baseUrl, '5.6.7.8, 10.0.0.1')).toBe(200);
  });

  test('with trustForwardedFor off, the header is ignored and all callers share one bucket', async () => {
    ctx = await createTestServer({ server: { rateLimit: { window: 60_000, max: 3, trustForwardedFor: false } } });

    expect(await hit(ctx.baseUrl, '1.1.1.1')).toBe(200);
    expect(await hit(ctx.baseUrl, '2.2.2.2')).toBe(200);
    expect(await hit(ctx.baseUrl, '3.3.3.3')).toBe(200);
    // Fourth request from a "different" forwarded client still hits the shared peer bucket.
    expect(await hit(ctx.baseUrl, '4.4.4.4')).toBe(429);
  });
});
