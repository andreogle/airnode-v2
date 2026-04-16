// =============================================================================
// Bounded map with periodic sweep
//
// A generic Map wrapper with a max size cap (FIFO eviction) and a periodic
// sweep that removes entries matching a predicate. Used by the response cache,
// ownership cache, payment proof tracker, and async request store.
//
// `refuseEvictionIf` (optional): when the map is full and the oldest entry
// matches this predicate, FIFO eviction is refused and `set` returns `false`.
// Used by security-sensitive stores (e.g. replay protection) to avoid losing
// entries inside their trust window under flooding.
// =============================================================================
interface BoundedMapOptions<V> {
  readonly maxEntries: number;
  readonly sweepIntervalMs: number;
  readonly shouldEvict: (value: V) => boolean;
  readonly refuseEvictionIf?: (value: V) => boolean;
}

interface BoundedMap<K, V> {
  readonly get: (key: K) => V | undefined;
  readonly set: (key: K, value: V) => boolean;
  readonly has: (key: K) => boolean;
  readonly delete: (key: K) => void;
  readonly clear: () => void;
  readonly values: () => readonly V[];
  readonly size: () => number;
  readonly stop: () => void;
}

function createBoundedMap<K, V>(options: BoundedMapOptions<V>): BoundedMap<K, V> {
  const store = new Map<K, V>();

  const sweepInterval = setInterval(() => {
    // eslint-disable-next-line functional/no-loop-statements
    for (const [key, value] of store) {
      if (options.shouldEvict(value)) {
        store.delete(key); // eslint-disable-line functional/immutable-data
      }
    }
  }, options.sweepIntervalMs);
  sweepInterval.unref();

  return {
    get: (key) => store.get(key),

    set: (key, value) => {
      if (store.size >= options.maxEntries) {
        const firstEntry = store.entries().next().value;
        if (firstEntry === undefined) return false;
        const [firstKey, firstValue] = firstEntry;
        if (options.refuseEvictionIf?.(firstValue)) return false;
        store.delete(firstKey); // eslint-disable-line functional/immutable-data
      }
      store.set(key, value); // eslint-disable-line functional/immutable-data
      return true;
    },

    has: (key) => store.has(key),

    delete: (key) => {
      store.delete(key); // eslint-disable-line functional/immutable-data
    },

    clear: () => {
      store.clear(); // eslint-disable-line functional/immutable-data
    },

    values: () => [...store.values()],

    size: () => store.size,

    stop: () => {
      clearInterval(sweepInterval);
    },
  };
}

export { createBoundedMap };
export type { BoundedMap };
