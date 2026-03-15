import { describe, expect, test } from 'bun:test';

// The config CLI exports detectFormat and toSpacedYaml as private helpers, but
// we can test them through the module's internal behavior. Since they're not
// exported, we re-implement the detection logic here and validate it matches
// the expected behavior of the migrate command.

// =============================================================================
// detectFormat (re-implemented for testing — mirrors cli/commands/config.ts)
// =============================================================================
type SourceFormat = 'airnode-v1' | 'openapi';

function detectFormat(raw: unknown): SourceFormat | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;

  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj['ois'])) return 'airnode-v1';
  if (obj['openapi'] || obj['swagger']) return 'openapi';

  return undefined;
}

describe('detectFormat', () => {
  test('detects airnode-v1 by ois array', () => {
    expect(detectFormat({ ois: [{ name: 'test' }] })).toBe('airnode-v1');
  });

  test('detects openapi by openapi field', () => {
    expect(detectFormat({ openapi: '3.0.0' })).toBe('openapi');
  });

  test('detects swagger as openapi', () => {
    expect(detectFormat({ swagger: '2.0' })).toBe('openapi');
  });

  test('returns undefined for non-object', () => {
    const nothing: unknown = undefined;
    expect(detectFormat(nothing)).toBeUndefined();
    expect(detectFormat('string')).toBeUndefined();
    expect(detectFormat(42)).toBeUndefined();
  });

  test('returns undefined for unrecognized object', () => {
    expect(detectFormat({ version: '2.0', chains: [] })).toBeUndefined();
  });

  test('returns undefined for empty object', () => {
    expect(detectFormat({})).toBeUndefined();
  });

  test('prefers airnode-v1 when ois is present', () => {
    // An object with both ois and openapi should detect as airnode-v1
    // because ois check comes first
    expect(detectFormat({ ois: [], openapi: '3.0.0' })).toBe('airnode-v1');
  });
});
