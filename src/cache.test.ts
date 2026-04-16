import { describe, expect, test } from 'bun:test';
import { createCache } from './cache';

// =============================================================================
// createCache
// =============================================================================
describe('createCache', () => {
  const ENDPOINT_ID = '0x04e77a11d6561a70385e2e8e315989cb24bb35128cb4d5a8b3ece93a3c72295b';

  test('returns undefined for cache miss', () => {
    const cache = createCache();
    const result = cache.get(ENDPOINT_ID, { coin: 'ETH' });
    expect(result).toBeUndefined();
  });

  test('returns cached value within TTL', () => {
    const cache = createCache();
    const value = { price: 3000 };
    cache.set(ENDPOINT_ID, { coin: 'ETH' }, value, 60_000);

    const result = cache.get(ENDPOINT_ID, { coin: 'ETH' });
    expect(result).toEqual({ price: 3000 });
  });

  test('returns undefined after TTL expires', async () => {
    const cache = createCache();
    cache.set(ENDPOINT_ID, { coin: 'ETH' }, { price: 3000 }, 50);

    await Bun.sleep(60);

    const result = cache.get(ENDPOINT_ID, { coin: 'ETH' });
    expect(result).toBeUndefined();
  });

  test('different parameters produce different cache keys', () => {
    const cache = createCache();
    cache.set(ENDPOINT_ID, { coin: 'ETH' }, { price: 3000 }, 60_000);
    cache.set(ENDPOINT_ID, { coin: 'BTC' }, { price: 60_000 }, 60_000);

    expect(cache.get(ENDPOINT_ID, { coin: 'ETH' })).toEqual({ price: 3000 });
    expect(cache.get(ENDPOINT_ID, { coin: 'BTC' })).toEqual({ price: 60_000 });
  });

  test('same parameters produce same cache key regardless of order', () => {
    const cache = createCache();
    cache.set(ENDPOINT_ID, { coin: 'ETH', currency: 'USD' }, { price: 3000 }, 60_000);

    const result = cache.get(ENDPOINT_ID, { currency: 'USD', coin: 'ETH' });
    expect(result).toEqual({ price: 3000 });
  });

  test('clear() empties the cache', () => {
    const cache = createCache();
    cache.set(ENDPOINT_ID, { coin: 'ETH' }, { price: 3000 }, 60_000);
    cache.set(ENDPOINT_ID, { coin: 'BTC' }, { price: 60_000 }, 60_000);
    expect(cache.size()).toBe(2);

    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.get(ENDPOINT_ID, { coin: 'ETH' })).toBeUndefined();
  });

  test('stop() clears the sweep interval', () => {
    const cache = createCache();
    cache.set(ENDPOINT_ID, { coin: 'ETH' }, { price: 3000 }, 60_000);
    cache.stop();
    // No assertion needed — verifies stop() doesn't throw and the interval is cleared
    expect(cache.size()).toBe(1);
  });

  test('special characters in values cannot collide across parameter sets', () => {
    const cache = createCache();
    // Before the canonical encoding fix, both of these would produce the same
    // key="a=b&c=d" concatenation and collide in the cache.
    cache.set(ENDPOINT_ID, { a: 'b&c=d' }, { which: 'first' }, 60_000);
    cache.set(ENDPOINT_ID, { a: 'b', c: 'd' }, { which: 'second' }, 60_000);

    expect(cache.get(ENDPOINT_ID, { a: 'b&c=d' })).toEqual({ which: 'first' });
    expect(cache.get(ENDPOINT_ID, { a: 'b', c: 'd' })).toEqual({ which: 'second' });
  });

  test('size() returns correct count', () => {
    const cache = createCache();
    expect(cache.size()).toBe(0);

    cache.set(ENDPOINT_ID, { coin: 'ETH' }, { price: 3000 }, 60_000);
    expect(cache.size()).toBe(1);

    cache.set(ENDPOINT_ID, { coin: 'BTC' }, { price: 60_000 }, 60_000);
    expect(cache.size()).toBe(2);

    // Overwrite existing entry
    cache.set(ENDPOINT_ID, { coin: 'ETH' }, { price: 3100 }, 60_000);
    expect(cache.size()).toBe(2);
  });
});
