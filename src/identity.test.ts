import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { buildTxtRecordHost, findAddressInRecords, queryTxtRecords, verifyIdentity } from './identity';

// =============================================================================
// buildTxtRecordHost
// =============================================================================
describe('buildTxtRecordHost', () => {
  test('builds correct host for chain 1', () => {
    expect(buildTxtRecordHost('api.coingecko.com', 1)).toBe('ERC-7529.1._domaincontracts.api.coingecko.com');
  });

  test('builds correct host for chain 137', () => {
    expect(buildTxtRecordHost('example.com', 137)).toBe('ERC-7529.137._domaincontracts.example.com');
  });
});

// =============================================================================
// findAddressInRecords
// =============================================================================
describe('findAddressInRecords', () => {
  const address = '0xC04575f78C599D91cA42C1fBf0Ef5f21cc277f6e';

  test('finds address in single-value record', () => {
    expect(findAddressInRecords([address], address)).toBe(true);
  });

  test('finds address in comma-separated record', () => {
    const record = `0xaaa0000000000000000000000000000000000001, ${address}, 0xbbb0000000000000000000000000000000000002`;
    expect(findAddressInRecords([record], address)).toBe(true);
  });

  test('matches case-insensitively', () => {
    expect(findAddressInRecords([address.toLowerCase()], address)).toBe(true);
    expect(findAddressInRecords([address.toUpperCase()], address)).toBe(true);
  });

  test('returns false when address not in records', () => {
    expect(findAddressInRecords(['0x0000000000000000000000000000000000000001'], address)).toBe(false);
  });

  test('returns false for empty records', () => {
    expect(findAddressInRecords([], address)).toBe(false);
  });
});

// =============================================================================
// queryTxtRecords (mocked fetch)
// =============================================================================
describe('queryTxtRecords', () => {
  const fetchMock = mock();
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    fetchMock.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('parses TXT records from DoH response', async () => {
    fetchMock.mockResolvedValue({
      json: () =>
        Promise.resolve({
          Status: 0,
          Answer: [{ type: 16, data: '"0xC04575f78C599D91cA42C1fBf0Ef5f21cc277f6e"' }],
        }),
    });

    const records = await queryTxtRecords('ERC-7529.1._domaincontracts.example.com');

    expect(records).toEqual(['0xC04575f78C599D91cA42C1fBf0Ef5f21cc277f6e']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('returns empty array when no answer', async () => {
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ Status: 3 }),
    });

    const records = await queryTxtRecords('ERC-7529.1._domaincontracts.nonexistent.com');

    expect(records).toEqual([]);
  });
});

// =============================================================================
// verifyIdentity
// =============================================================================
describe('verifyIdentity', () => {
  const fetchMock = mock();
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    fetchMock.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('verifies single address', async () => {
    const address = '0xC04575f78C599D91cA42C1fBf0Ef5f21cc277f6e';
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ Status: 0, Answer: [{ type: 16, data: `"${address}"` }] }),
    });

    const results = await verifyIdentity([address], 'example.com');

    expect(results).toEqual([{ address, verified: true }]);
  });

  test('verifies multiple addresses against comma-separated record', async () => {
    const addr1 = '0xC04575f78C599D91cA42C1fBf0Ef5f21cc277f6e';
    const addr2 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
    const missing = '0x0000000000000000000000000000000000000001';
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ Status: 0, Answer: [{ type: 16, data: `"${addr1}, ${addr2}"` }] }),
    });

    const results = await verifyIdentity([addr1, addr2, missing], 'example.com');

    expect(results).toEqual([
      { address: addr1, verified: true },
      { address: addr2, verified: true },
      { address: missing, verified: false },
    ]);
  });

  test('returns all unverified when no TXT records exist', async () => {
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ Status: 3 }),
    });

    const results = await verifyIdentity(['0xC04575f78C599D91cA42C1fBf0Ef5f21cc277f6e'], 'nonexistent.com');

    expect(results).toEqual([{ address: '0xC04575f78C599D91cA42C1fBf0Ef5f21cc277f6e', verified: false }]);
  });

  test('uses custom chain ID', async () => {
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ Status: 3 }),
    });

    await verifyIdentity(['0xC04575f78C599D91cA42C1fBf0Ef5f21cc277f6e'], 'example.com', 137);

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('ERC-7529.137._domaincontracts.example.com');
  });
});
