import { describe, expect, test } from 'bun:test';
import { isWithinRateLimit } from './rate-limit';
import type { TokenBucket } from './rate-limit';

describe('isWithinRateLimit', () => {
  test('allows first request from a new IP', () => {
    const buckets = new Map<string, TokenBucket>();
    expect(isWithinRateLimit('1.2.3.4', buckets, 60_000, 10)).toBe(true);
    expect(buckets.size).toBe(1);
  });

  test('allows requests up to max tokens', () => {
    const buckets = new Map<string, TokenBucket>();
    const windowMs = 60_000;
    const maxTokens = 3;

    expect(isWithinRateLimit('1.2.3.4', buckets, windowMs, maxTokens)).toBe(true);
    expect(isWithinRateLimit('1.2.3.4', buckets, windowMs, maxTokens)).toBe(true);
    expect(isWithinRateLimit('1.2.3.4', buckets, windowMs, maxTokens)).toBe(true);
    // 4th request exceeds limit
    expect(isWithinRateLimit('1.2.3.4', buckets, windowMs, maxTokens)).toBe(false);
  });

  test('tracks IPs independently', () => {
    const buckets = new Map<string, TokenBucket>();

    expect(isWithinRateLimit('1.1.1.1', buckets, 60_000, 1)).toBe(true);
    expect(isWithinRateLimit('2.2.2.2', buckets, 60_000, 1)).toBe(true);
    // Both exhausted
    expect(isWithinRateLimit('1.1.1.1', buckets, 60_000, 1)).toBe(false);
    expect(isWithinRateLimit('2.2.2.2', buckets, 60_000, 1)).toBe(false);
  });

  test('refills tokens over time', async () => {
    const buckets = new Map<string, TokenBucket>();
    const windowMs = 100; // 100ms window
    const maxTokens = 2;

    expect(isWithinRateLimit('1.2.3.4', buckets, windowMs, maxTokens)).toBe(true);
    expect(isWithinRateLimit('1.2.3.4', buckets, windowMs, maxTokens)).toBe(true);
    expect(isWithinRateLimit('1.2.3.4', buckets, windowMs, maxTokens)).toBe(false);

    // Wait for refill
    await Bun.sleep(120);

    expect(isWithinRateLimit('1.2.3.4', buckets, windowMs, maxTokens)).toBe(true);
  });

  test('evicts oldest entries when exceeding 10k limit', () => {
    const buckets = new Map<string, TokenBucket>();

    // Fill past the limit

    for (let i = 0; i <= 10_001; i++) {
      isWithinRateLimit(`ip-${String(i)}`, buckets, 60_000, 10);
    }

    // Should have evicted the oldest entries
    expect(buckets.size).toBeLessThanOrEqual(10_001);
    // The first IP should have been evicted
    expect(buckets.has('ip-0')).toBe(false);
  });
});
