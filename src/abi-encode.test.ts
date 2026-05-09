import { describe, expect, test } from 'bun:test';
import type { Hex } from 'viem';
import { decode, encode } from './abi-encode';

// Pre-computed expected encodings for exact verification
const ENCODED_EMPTY =
  '0x010000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000' as const;

const ENCODED_SINGLE =
  '0x01000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000036964730000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000008657468657265756d000000000000000000000000000000000000000000000000' as const;

const ENCODED_MULTI =
  '0x010000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000036964730000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000d76735f63757272656e63696573000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000008657468657265756d00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000037573640000000000000000000000000000000000000000000000000000000000' as const;

const ENCODED_NUMERIC =
  '0x010000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000036d696e000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000036d617800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000001300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000033130300000000000000000000000000000000000000000000000000000000000' as const;

const ENCODED_ORDER_AB =
  '0x010000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000016100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000162000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000001310000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000013200000000000000000000000000000000000000000000000000000000000000' as const;

const ENCODED_ORDER_BA =
  '0x010000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000016200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000161000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000001320000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000013100000000000000000000000000000000000000000000000000000000000000' as const;

describe('encode', () => {
  test('encodes empty parameters', () => {
    expect(encode([])).toBe(ENCODED_EMPTY);
  });

  test('encodes a single parameter', () => {
    expect(encode([{ name: 'ids', value: 'ethereum' }])).toBe(ENCODED_SINGLE);
  });

  test('encodes multiple parameters', () => {
    const encoded = encode([
      { name: 'ids', value: 'ethereum' },
      { name: 'vs_currencies', value: 'usd' },
    ]);
    expect(encoded).toBe(ENCODED_MULTI);
  });

  test('encodes numeric string values', () => {
    const encoded = encode([
      { name: 'min', value: '0' },
      { name: 'max', value: '100' },
    ]);
    expect(encoded).toBe(ENCODED_NUMERIC);
  });

  test('encodes special characters in values', () => {
    const encoded = encode([{ name: 'query', value: 'hello world & foo=bar' }]);
    const decoded = decode(encoded);
    expect(decoded.query).toBe('hello world & foo=bar');
  });

  test('encodes unicode values', () => {
    const encoded = encode([{ name: 'city', value: 'Zurich' }]);
    const decoded = decode(encoded);
    expect(decoded.city).toBe('Zurich');
  });

  test('encodes empty string values', () => {
    const encoded = encode([{ name: 'optional', value: '' }]);
    const decoded = decode(encoded);
    expect(decoded.optional).toBe('');
  });

  test('encodes long values', () => {
    const longValue = 'a'.repeat(10_000);
    const encoded = encode([{ name: 'data', value: longValue }]);
    const decoded = decode(encoded);
    expect(decoded.data).toBe(longValue);
  });
});

describe('decode', () => {
  test('decodes single parameter from exact hex', () => {
    expect(decode(ENCODED_SINGLE)).toEqual({ ids: 'ethereum' });
  });

  test('decodes multiple parameters from exact hex', () => {
    expect(decode(ENCODED_MULTI)).toEqual({
      ids: 'ethereum',
      vs_currencies: 'usd',
    });
  });

  test('decodes numeric values from exact hex', () => {
    expect(decode(ENCODED_NUMERIC)).toEqual({
      min: '0',
      max: '100',
    });
  });

  test('decodes empty parameter list from exact hex', () => {
    expect(decode(ENCODED_EMPTY)).toEqual({});
  });

  test('returns empty object for empty hex', () => {
    expect(decode('0x')).toEqual({});
  });

  test('throws on short hex data', () => {
    expect(() => decode('0x01')).toThrow('Data too short');
  });

  test('throws on unsupported version', () => {
    const tampered = ENCODED_SINGLE.replace(/^0x01/, '0x02') as Hex;
    expect(() => decode(tampered)).toThrow('Unsupported encoding version: 2');
  });

  test('throws on version 0', () => {
    const tampered = ENCODED_SINGLE.replace(/^0x01/, '0x00') as Hex;
    expect(() => decode(tampered)).toThrow('Unsupported encoding version: 0');
  });

  test('preserves parameter order in keys', () => {
    const parameters = [
      { name: 'z_last', value: '3' },
      { name: 'a_first', value: '1' },
      { name: 'm_middle', value: '2' },
    ];
    const decoded = decode(encode(parameters));
    const keys = Object.keys(decoded);
    expect(keys).toEqual(['z_last', 'a_first', 'm_middle']);
  });

  test('handles many parameters', () => {
    const parameters = Array.from({ length: 50 }, (_, index) => ({
      name: `param_${String(index)}`,
      value: `value_${String(index)}`,
    }));
    const decoded = decode(encode(parameters));
    expect(Object.keys(decoded)).toHaveLength(50);
    expect(decoded.param_0).toBe('value_0');
    expect(decoded.param_49).toBe('value_49');
  });
});

describe('encode/decode roundtrip', () => {
  test('roundtrips typical API parameters', () => {
    const parameters = [
      { name: 'ids', value: 'ethereum' },
      { name: 'vs_currencies', value: 'usd' },
      { name: 'include_24hr_vol', value: 'true' },
    ];
    expect(decode(encode(parameters))).toEqual({
      ids: 'ethereum',
      vs_currencies: 'usd',
      include_24hr_vol: 'true',
    });
  });

  test('roundtrips numeric values as strings', () => {
    const parameters = [
      { name: 'min', value: '0' },
      { name: 'max', value: '999999999999999999' },
      { name: 'precision', value: '3.14159' },
    ];
    const decoded = decode(encode(parameters));
    expect(decoded.min).toBe('0');
    expect(decoded.max).toBe('999999999999999999');
    expect(decoded.precision).toBe('3.14159');
  });

  test('roundtrips parameters with special characters', () => {
    const parameters = [
      { name: 'q', value: 'New York, NY' },
      { name: 'format', value: 'json&pretty=true' },
      { name: 'path', value: '/api/v1/data' },
    ];
    const decoded = decode(encode(parameters));
    expect(decoded.q).toBe('New York, NY');
    expect(decoded.format).toBe('json&pretty=true');
    expect(decoded.path).toBe('/api/v1/data');
  });

  test('roundtrips empty string parameter', () => {
    const parameters = [
      { name: 'required', value: 'yes' },
      { name: 'optional', value: '' },
    ];
    const decoded = decode(encode(parameters));
    expect(decoded.required).toBe('yes');
    expect(decoded.optional).toBe('');
  });

  test('produces deterministic output', () => {
    const parameters = [
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
    ];
    const first = encode(parameters);
    const second = encode(parameters);
    expect(first).toBe(ENCODED_ORDER_AB);
    expect(second).toBe(ENCODED_ORDER_AB);
  });

  test('different parameter order produces different encoding', () => {
    const ab = encode([
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
    ]);
    const ba = encode([
      { name: 'b', value: '2' },
      { name: 'a', value: '1' },
    ]);
    expect(ab).toBe(ENCODED_ORDER_AB);
    expect(ba).toBe(ENCODED_ORDER_BA);
    expect(ab).not.toBe(ba);
    // But both decode to the same logical values
    expect(decode(ab)).toEqual(decode(ba));
  });

  test('duplicate names — last value wins', () => {
    const parameters = [
      { name: 'key', value: 'first' },
      { name: 'key', value: 'second' },
    ];
    const decoded = decode(encode(parameters));
    expect(decoded.key).toBe('second');
  });
});

describe('version byte', () => {
  test('first byte is always 0x01', () => {
    expect(ENCODED_SINGLE.slice(0, 4)).toBe('0x01');
    expect(ENCODED_MULTI.slice(0, 4)).toBe('0x01');
    expect(ENCODED_EMPTY.slice(0, 4)).toBe('0x01');
    expect(ENCODED_NUMERIC.slice(0, 4)).toBe('0x01');
  });
});
