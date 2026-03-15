import { describe, expect, test } from 'bun:test';
import type { Hex } from 'viem';
import { processResponse } from './process';

describe('processResponse', () => {
  describe('single value', () => {
    test('encodes int256', () => {
      const result = processResponse({ value: 123 }, { type: 'int256', path: '$.value' });

      expect(result).toBe('0x000000000000000000000000000000000000000000000000000000000000007b');
    });

    test('encodes negative int256', () => {
      const result = processResponse({ value: -1 }, { type: 'int256', path: '$.value' });

      expect(result).toBe('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
    });

    test('encodes uint256', () => {
      const result = processResponse({ price: 50_000 }, { type: 'uint256', path: '$.price' });

      expect(result).toBe('0x000000000000000000000000000000000000000000000000000000000000c350');
    });

    test('encodes bool true', () => {
      const result = processResponse({ active: true }, { type: 'bool', path: '$.active' });

      expect(result).toBe('0x0000000000000000000000000000000000000000000000000000000000000001');
    });

    test('encodes bool false', () => {
      const result = processResponse({ active: false }, { type: 'bool', path: '$.active' });

      expect(result).toBe('0x0000000000000000000000000000000000000000000000000000000000000000');
    });

    test('encodes string "true" as bool true', () => {
      const result = processResponse({ active: 'true' }, { type: 'bool', path: '$.active' });

      expect(result).toBe('0x0000000000000000000000000000000000000000000000000000000000000001');
    });

    test('encodes bytes32 from string', () => {
      const result = processResponse({ id: 'hello' }, { type: 'bytes32', path: '$.id' });

      expect(result).toBe('0x68656c6c6f000000000000000000000000000000000000000000000000000000');
    });

    test('encodes address', () => {
      const addr = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
      const result = processResponse({ wallet: addr }, { type: 'address', path: '$.wallet' });

      expect(result).toBe('0x000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045');
    });

    test('encodes string', () => {
      const result = processResponse({ name: 'hello' }, { type: 'string', path: '$.name' });

      // prettier-ignore
      expect(result).toBe('0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000568656c6c6f000000000000000000000000000000000000000000000000000000' as const);
    });

    test('encodes bytes from hex string', () => {
      const result = processResponse({ payload: '0xdeadbeef' }, { type: 'bytes', path: '$.payload' });

      // prettier-ignore
      expect(result).toBe('0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000004deadbeef00000000000000000000000000000000000000000000000000000000' as const);
    });
  });

  describe('with multiplier', () => {
    test('applies times multiplier', () => {
      const result = processResponse({ price: 1.5 }, { type: 'uint256', path: '$.price', times: '1000' });

      expect(result).toBe('0x00000000000000000000000000000000000000000000000000000000000005dc');
    });

    test('truncates fractional result after multiplication', () => {
      const result = processResponse({ price: 1.23 }, { type: 'int256', path: '$.price', times: '10' });

      expect(result).toBe('0x000000000000000000000000000000000000000000000000000000000000000c');
    });

    test('no multiplier truncates to integer', () => {
      const result = processResponse({ price: 0.99 }, { type: 'uint256', path: '$.price' });

      expect(result).toBe('0x0000000000000000000000000000000000000000000000000000000000000000');
    });
  });

  describe('multiple values (comma-separated)', () => {
    test('encodes two values', () => {
      const result = processResponse({ price: 100, active: true }, { type: 'uint256,bool', path: '$.price,$.active' });

      const expected: Hex =
        '0x00000000000000000000000000000000000000000000000000000000000000640000000000000000000000000000000000000000000000000000000000000001';
      expect(result).toBe(expected);
    });

    test('applies per-value multipliers', () => {
      const result = processResponse(
        { a: 1.5, b: 2.5 },
        { type: 'uint256,uint256', path: '$.a,$.b', times: '100,100' }
      );

      const expected: Hex =
        '0x000000000000000000000000000000000000000000000000000000000000009600000000000000000000000000000000000000000000000000000000000000fa';
      expect(result).toBe(expected);
    });

    test('empty times entry means no multiplication', () => {
      const result = processResponse({ a: 1.5, b: 2.5 }, { type: 'uint256,uint256', path: '$.a,$.b', times: ',100' });

      // a: 1.5 truncated to 1, b: 2.5 * 100 = 250
      const expected: Hex =
        '0x000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000fa';
      expect(result).toBe(expected);
    });

    test('encodes mixed static and dynamic types', () => {
      const result = processResponse({ count: 7, label: 'test' }, { type: 'int256,string', path: '$.count,$.label' });

      const expected: Hex =
        '0x0000000000000000000000000000000000000000000000000000000000000007000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000047465737400000000000000000000000000000000000000000000000000000000';
      expect(result).toBe(expected);
    });

    test('throws when type and path count mismatch', () => {
      expect(() => processResponse({ price: 100 }, { type: 'uint256,bool', path: '$.price' })).toThrow(
        'type has 2 entries but path has 1'
      );
    });
  });

  describe('error cases', () => {
    test('throws when path does not exist', () => {
      expect(() => processResponse({ value: 123 }, { type: 'uint256', path: '$.missing' })).toThrow(
        'No value found at path: $.missing'
      );
    });

    test('throws for invalid number conversion', () => {
      expect(() => processResponse({ value: 'not-a-number' }, { type: 'uint256', path: '$.value' })).toThrow(
        'Cannot convert "not-a-number" to uint256'
      );
    });

    test('throws for invalid Solidity type', () => {
      expect(() => processResponse({ value: 1 }, { type: 'float', path: '$.value' })).toThrow(
        'Invalid Solidity type: float'
      );
    });
  });
});
