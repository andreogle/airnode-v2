import { afterEach, describe, expect, test } from 'bun:test';
import { createBoundedMap } from './bounded-map';
import type { BoundedMap } from './bounded-map';

describe('createBoundedMap', () => {
  const handles: BoundedMap<string, { value: number; createdAt: number }>[] = [];

  afterEach(() => {
    for (const handle of handles) {
      handle.stop();
    }
    handles.length = 0;
  });

  function create(
    maxEntries = 100,
    shouldEvict: (v: { value: number; createdAt: number }) => boolean = () => false
  ): BoundedMap<string, { value: number; createdAt: number }> {
    const map = createBoundedMap<string, { value: number; createdAt: number }>({
      maxEntries,
      sweepIntervalMs: 50,
      shouldEvict,
    });
    handles.push(map);
    return map;
  }

  test('get and set', () => {
    const map = create();
    map.set('a', { value: 1, createdAt: Date.now() });
    expect(map.get('a')?.value).toBe(1);
    expect(map.get('b')).toBeUndefined();
  });

  test('has and delete', () => {
    const map = create();
    map.set('a', { value: 1, createdAt: Date.now() });
    expect(map.has('a')).toBe(true);
    map.delete('a');
    expect(map.has('a')).toBe(false);
  });

  test('clear removes all entries', () => {
    const map = create();
    map.set('a', { value: 1, createdAt: Date.now() });
    map.set('b', { value: 2, createdAt: Date.now() });
    expect(map.size()).toBe(2);
    map.clear();
    expect(map.size()).toBe(0);
  });

  test('values returns all entries', () => {
    const map = create();
    map.set('a', { value: 1, createdAt: Date.now() });
    map.set('b', { value: 2, createdAt: Date.now() });
    const values = map.values();
    expect(values).toHaveLength(2);
    expect(values.map((v) => v.value).toSorted()).toEqual([1, 2]);
  });

  test('evicts oldest entries when exceeding maxEntries', () => {
    const map = create(3);
    map.set('a', { value: 1, createdAt: Date.now() });
    map.set('b', { value: 2, createdAt: Date.now() });
    map.set('c', { value: 3, createdAt: Date.now() });
    // Adding 4th should evict 'a' (FIFO)
    map.set('d', { value: 4, createdAt: Date.now() });

    expect(map.size()).toBe(3);
    expect(map.has('a')).toBe(false);
    expect(map.has('d')).toBe(true);
  });

  test('periodic sweep removes entries matching predicate', async () => {
    const cutoff = Date.now();
    const map = create(100, (entry) => entry.createdAt < cutoff);

    map.set('old', { value: 1, createdAt: cutoff - 1000 });
    map.set('new', { value: 2, createdAt: cutoff + 1000 });

    // Wait for sweep to run
    await Bun.sleep(100);

    expect(map.has('old')).toBe(false);
    expect(map.has('new')).toBe(true);
  });

  test('stop prevents further sweeps', async () => {
    const cutoff = Date.now() + 200;
    const map = create(100, (entry) => entry.createdAt < cutoff);

    map.set('a', { value: 1, createdAt: Date.now() });
    map.stop();

    // Even after waiting, the entry should remain because sweep was stopped
    await Bun.sleep(100);
    expect(map.has('a')).toBe(true);
  });
});
