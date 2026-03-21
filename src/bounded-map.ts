// =============================================================================
// Bounded map with periodic sweep
//
// A generic Map wrapper with a max size cap (FIFO eviction) and a periodic
// sweep that removes entries matching a predicate. Used by the response cache,
// ownership cache, payment proof tracker, and async request store.
// =============================================================================
interface BoundedMapOptions<V> {
  readonly maxEntries: number;
  readonly sweepIntervalMs: number;
  readonly shouldEvict: (value: V) => boolean;
}

interface BoundedMap<K, V> {
  readonly get: (key: K) => V | undefined;
  readonly set: (key: K, value: V) => void;
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
        const firstKey = store.keys().next().value;
        if (firstKey !== undefined) store.delete(firstKey); // eslint-disable-line functional/immutable-data
      }
      store.set(key, value); // eslint-disable-line functional/immutable-data
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
