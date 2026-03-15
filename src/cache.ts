import { keccak256, toHex } from 'viem';
import { createBoundedMap } from './bounded-map';

// =============================================================================
// Types
// =============================================================================
interface CacheEntry {
  readonly value: unknown;
  readonly expiresAt: number;
}

interface ResponseCache {
  readonly get: (endpointId: string, parameters: Record<string, string>) => unknown;
  readonly set: (endpointId: string, parameters: Record<string, string>, value: unknown, maxAge: number) => void;
  readonly clear: () => void;
  readonly size: () => number;
  readonly stop: () => void;
}

// =============================================================================
// Key derivation
// =============================================================================
function deriveCacheKey(endpointId: string, parameters: Record<string, string>): string {
  const sortedParamString = Object.keys(parameters)
    .toSorted()
    .map((key) => `${key}=${String(parameters[key])}`)
    .join('&');

  return keccak256(toHex(`${endpointId}|${sortedParamString}`));
}

// =============================================================================
// Cache factory
// =============================================================================
function createCache(): ResponseCache {
  const store = createBoundedMap<string, CacheEntry>({
    maxEntries: 10_000,
    sweepIntervalMs: 60_000,
    shouldEvict: (entry) => Date.now() > entry.expiresAt,
  });

  return {
    get: (endpointId, parameters) => {
      const key = deriveCacheKey(endpointId, parameters);
      const entry = store.get(key);
      if (!entry) return;

      if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return;
      }

      return entry.value;
    },

    set: (endpointId, parameters, value, maxAge) => {
      const key = deriveCacheKey(endpointId, parameters);
      store.set(key, { value, expiresAt: Date.now() + maxAge });
    },

    clear: () => {
      store.clear();
    },
    size: () => store.size(),
    stop: () => {
      store.stop();
    },
  };
}

export { createCache };
export type { ResponseCache };
