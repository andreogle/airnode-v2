// =============================================================================
// Token bucket rate limiting
// =============================================================================
interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

const MAX_RATE_LIMIT_ENTRIES = 10_000;

function evictOldestBuckets(buckets: Map<string, TokenBucket>): void {
  if (buckets.size <= MAX_RATE_LIMIT_ENTRIES) return;

  const toEvict = buckets.size - MAX_RATE_LIMIT_ENTRIES;
  const iterator = buckets.keys();
  // eslint-disable-next-line functional/no-loop-statements, functional/no-let
  for (let i = 0; i < toEvict; i++) {
    const key = iterator.next().value;
    if (key) buckets.delete(key); // eslint-disable-line functional/immutable-data
  }
}

function checkRateLimit(ip: string, buckets: Map<string, TokenBucket>, windowMs: number, maxTokens: number): boolean {
  const now = Date.now();
  const existing = buckets.get(ip);

  if (!existing) {
    evictOldestBuckets(buckets);
    buckets.set(ip, { tokens: maxTokens - 1, lastRefill: now }); // eslint-disable-line functional/immutable-data
    return true;
  }

  const elapsed = now - existing.lastRefill;
  const refillRate = maxTokens / windowMs;
  const refilled = Math.min(maxTokens, existing.tokens + elapsed * refillRate);

  if (refilled < 1) {
    return false;
  }

  existing.tokens = refilled - 1; // eslint-disable-line functional/immutable-data
  existing.lastRefill = now; // eslint-disable-line functional/immutable-data
  return true;
}

export { checkRateLimit };
export type { TokenBucket };
