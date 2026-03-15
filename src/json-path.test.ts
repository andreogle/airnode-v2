import { describe, expect, test } from 'bun:test';
import { query, queryAll } from './json-path';

describe('query', () => {
  const data = {
    store: {
      book: [
        { title: 'A', price: 10, active: true },
        { title: 'B', price: 20, active: false },
        { title: 'C', price: 30, active: true },
        { title: 'D', price: 40, active: true },
      ],
      name: 'My Store',
      meta: { location: { city: 'NYC', zip: '10001' } },
    },
    empty: [],
    flat: 42,
  };

  // ===========================================================================
  // Dot notation
  // ===========================================================================
  test('root reference returns whole object', () => {
    expect(query(data, '$')).toEqual(data);
  });

  test('simple dot path', () => {
    expect(query(data, '$.store.name')).toBe('My Store');
  });

  test('nested dot path', () => {
    expect(query(data, '$.store.meta.location.city')).toBe('NYC');
  });

  test('top-level scalar', () => {
    expect(query(data, '$.flat')).toBe(42);
  });

  test('missing property returns undefined', () => {
    expect(query(data, '$.store.nonexistent')).toBeUndefined();
  });

  test('deep missing property returns undefined', () => {
    expect(query(data, '$.store.meta.location.country')).toBeUndefined();
  });

  // ===========================================================================
  // Bracket notation
  // ===========================================================================
  test('bracket property access', () => {
    expect(query(data, "$['store']['name']")).toBe('My Store');
  });

  test('double-quoted bracket access', () => {
    expect(query(data, '$["store"]["name"]')).toBe('My Store');
  });

  // ===========================================================================
  // Array indices
  // ===========================================================================
  test('array index [0]', () => {
    expect(query(data, '$.store.book[0].title')).toBe('A');
  });

  test('array index [2]', () => {
    expect(query(data, '$.store.book[2].price')).toBe(30);
  });

  test('negative array index [-1]', () => {
    expect(query(data, '$.store.book[-1].title')).toBe('D');
  });

  test('negative array index [-2]', () => {
    expect(query(data, '$.store.book[-2].title')).toBe('C');
  });

  test('out-of-bounds index returns undefined', () => {
    expect(query(data, '$.store.book[99]')).toBeUndefined();
  });

  // ===========================================================================
  // Array slices
  // ===========================================================================
  test('slice [0:2]', () => {
    const result = query(data, '$.store.book[0:2]');
    expect(result).toEqual([
      { title: 'A', price: 10, active: true },
      { title: 'B', price: 20, active: false },
    ]);
  });

  test('slice [1:]', () => {
    const result = query(data, '$.store.book[1:]');
    expect(result).toEqual([
      { title: 'B', price: 20, active: false },
      { title: 'C', price: 30, active: true },
      { title: 'D', price: 40, active: true },
    ]);
  });

  test('slice [:2]', () => {
    const result = query(data, '$.store.book[:2]');
    expect(result).toEqual([
      { title: 'A', price: 10, active: true },
      { title: 'B', price: 20, active: false },
    ]);
  });

  test('slice with negative [-2:]', () => {
    const result = query(data, '$.store.book[-2:]');
    expect(result).toEqual([
      { title: 'C', price: 30, active: true },
      { title: 'D', price: 40, active: true },
    ]);
  });

  // ===========================================================================
  // Wildcard
  // ===========================================================================
  test('wildcard on array [*]', () => {
    const result = queryAll(data, '$.store.book[*].title');
    expect(result).toEqual(['A', 'B', 'C', 'D']);
  });

  test('wildcard on object .*', () => {
    const result = queryAll(data, '$.store.meta.location.*');
    expect(result).toEqual(['NYC', '10001']);
  });

  // ===========================================================================
  // Deep scan
  // ===========================================================================
  test('deep scan for property', () => {
    const result = queryAll(data, '$..city');
    expect(result).toEqual(['NYC']);
  });

  test('deep scan for title returns all titles', () => {
    const result = queryAll(data, '$..title');
    expect(result).toEqual(['A', 'B', 'C', 'D']);
  });

  test('deep scan for price returns all prices', () => {
    const result = queryAll(data, '$..price');
    expect(result).toEqual([10, 20, 30, 40]);
  });

  // ===========================================================================
  // Filter
  // ===========================================================================
  test('filter with boolean equality', () => {
    const result = queryAll(data, '$.store.book[?(@.active==true)].title');
    expect(result).toEqual(['A', 'C', 'D']);
  });

  test('filter with numeric comparison', () => {
    const result = queryAll(data, '$.store.book[?(@.price>20)].title');
    expect(result).toEqual(['C', 'D']);
  });

  test('filter with string equality', () => {
    const result = queryAll(data, "$.store.book[?(@.title=='B')].price");
    expect(result).toEqual([20]);
  });

  test('filter !=', () => {
    const result = queryAll(data, '$.store.book[?(@.active!=true)].title');
    expect(result).toEqual(['B']);
  });

  test('filter >=', () => {
    const result = queryAll(data, '$.store.book[?(@.price>=30)].title');
    expect(result).toEqual(['C', 'D']);
  });

  test('filter <=', () => {
    const result = queryAll(data, '$.store.book[?(@.price<=20)].title');
    expect(result).toEqual(['A', 'B']);
  });

  // ===========================================================================
  // Union
  // ===========================================================================
  test('union of array indices [0,2]', () => {
    const result = queryAll(data, '$.store.book[0,2].title');
    expect(result).toEqual(['A', 'C']);
  });

  // ===========================================================================
  // Edge cases
  // ===========================================================================
  test('null value in path', () => {
    expect(query({ a: null }, '$.a')).toBeNull(); // eslint-disable-line unicorn/no-null
  });

  test('boolean value', () => {
    expect(query({ flag: false }, '$.flag')).toBe(false);
  });

  test('empty array', () => {
    expect(query(data, '$.empty[0]')).toBeUndefined();
  });

  test('path on scalar returns undefined', () => {
    expect(query(42, '$.foo')).toBeUndefined();
  });

  test('throws on path not starting with $', () => {
    expect(() => query(data, 'store.name')).toThrow('must start with $');
  });

  test('throws on unclosed bracket', () => {
    expect(() => query(data, '$.store[0')).toThrow('Unclosed bracket');
  });

  // ===========================================================================
  // Real-world config paths
  // ===========================================================================
  test('CoinGecko price path: $.ethereum.usd', () => {
    const response = { ethereum: { usd: 3500.42 } };
    expect(query(response, '$.ethereum.usd')).toBe(3500.42);
  });

  test('CoinGecko market data: $.market_data.current_price.usd', () => {
    const response = { market_data: { current_price: { usd: 3500 } } };
    expect(query(response, '$.market_data.current_price.usd')).toBe(3500);
  });

  test('Weather API: $.current.temp_c', () => {
    const response = { current: { temp_c: 22.5 } };
    expect(query(response, '$.current.temp_c')).toBe(22.5);
  });

  test('Random.org: $.result.random.data[0]', () => {
    const response = { result: { random: { data: [42, 17, 83] } } };
    expect(query(response, '$.result.random.data[0]')).toBe(42);
  });

  test('CoinGecko multi: $.ethereum.usd_24h_vol', () => {
    const response = { ethereum: { usd: 3500, usd_24h_vol: 1_500_000_000 } };
    expect(query(response, '$.ethereum.usd_24h_vol')).toBe(1_500_000_000);
  });

  // ===========================================================================
  // Additional edge cases for coverage
  // ===========================================================================
  test('bare property after $ without dot', () => {
    const object = { store: 'hello' };
    expect(query(object, '$store')).toBe('hello');
  });

  test('bare property followed by bracket', () => {
    const object = { items: [10, 20, 30] };
    expect(query(object, '$items[1]')).toBe(20);
  });

  test('wildcard on scalar returns empty', () => {
    expect(query(42, '$[*]')).toBeUndefined();
  });

  test('wildcard on string returns empty', () => {
    expect(query('hello', '$[*]')).toBeUndefined();
  });

  test('deep scan with wildcard $..[*]', () => {
    const object = { a: { b: [1, 2] }, c: 3 };
    const result = queryAll(object, '$..[*]');
    // Deep scan collects all values from all levels
    expect(result.length).toBeGreaterThan(0);
    // Should include the nested object, the number, and array elements
    expect(result).toContainEqual({ b: [1, 2] });
    expect(result).toContain(3);
  });

  test('deep scan with dot-wildcard $..*', () => {
    const object = { a: { x: 1 }, b: 2 };
    const result = queryAll(object, '$..*');
    expect(result.length).toBeGreaterThan(0);
  });

  test('unsupported filter expression throws', () => {
    expect(() => query([{ a: 1 }], '$[?@.a]')).toThrow('Unsupported filter');
  });

  test('filter >= boundary', () => {
    const items = [{ v: 19 }, { v: 20 }, { v: 21 }];
    const result = queryAll({ items }, '$.items[?(@.v>=20)].v');
    expect(result).toEqual([20, 21]);
  });

  test('filter <= boundary', () => {
    const items = [{ v: 29 }, { v: 30 }, { v: 31 }];
    const result = queryAll({ items }, '$.items[?(@.v<=30)].v');
    expect(result).toEqual([29, 30]);
  });

  test('union with negative indices', () => {
    const array = [10, 20, 30, 40];
    const result = queryAll({ arr: array }, '$.arr[-1,-2]');
    expect(result).toEqual([40, 30]);
  });

  test('union with mixed positive and negative indices', () => {
    const array = [10, 20, 30, 40];
    const result = queryAll({ arr: array }, '$.arr[0,-1]');
    expect(result).toEqual([10, 40]);
  });

  test('numeric bracket index on non-array returns empty', () => {
    const object = { a: 'hello' };
    expect(query(object, '$.a[0]')).toBeUndefined();
  });

  test('unquoted bracket property access', () => {
    const object = { abc: 42 };
    expect(query(object, '$[abc]')).toBe(42);
  });

  test('unquoted bracket for missing property', () => {
    const object = { abc: 42 };
    expect(query(object, '$[xyz]')).toBeUndefined();
  });

  test('unquoted bracket on array target', () => {
    expect(query([1, 2], '$[abc]')).toBeUndefined();
  });

  test('deep scan ending with .. throws', () => {
    expect(() => query({ a: 1 }, '$..')).toThrow('Deep scan (..) must be followed by');
  });

  test('deep scan at end of longer path throws', () => {
    expect(() => query({ store: { a: 1 } }, '$.store..')).toThrow('Deep scan (..) must be followed by');
  });
});
