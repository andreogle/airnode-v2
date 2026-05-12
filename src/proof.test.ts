import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { requestProof } from './proof';
import type { ReclaimProof } from './proof';

const originalFetch = globalThis.fetch;
const fetchMock = mock();

const GATEWAY_URL = 'https://prove.example.com/v1/prove';

const MOCK_PROOF: ReclaimProof = {
  claim: {
    provider: 'http',
    parameters: '{"url":"https://api.example.com/price","method":"GET","responseMatches":[]}',
    context: '{"extractedParameters":{"price":"2064.01"}}',
    owner: '0x1234567890abcdef1234567890abcdef12345678',
    timestampS: 1_700_000_000,
    epoch: 1,
    identifier: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  },
  signatures: {
    attestorAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    claimSignature: '0x1234567890abcdef',
  },
};

describe('requestProof', () => {
  beforeEach(() => {
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_PROOF),
    });
  });

  afterEach(() => {
    fetchMock.mockClear();
    globalThis.fetch = originalFetch;
  });

  test('calls the gateway with correct URL and body', async () => {
    await requestProof(GATEWAY_URL, {
      url: 'https://api.example.com/price',
      method: 'GET',
    });

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://prove.example.com/v1/prove');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body as string)).toEqual({
      url: 'https://api.example.com/price',
      method: 'GET',
    });
  });

  test('returns the proof from the gateway response', async () => {
    const proof = await requestProof(GATEWAY_URL, {
      url: 'https://api.example.com/price',
      method: 'GET',
    });

    expect(proof.claim.provider).toBe('http');
    expect(proof.claim.identifier).toBe(MOCK_PROOF.claim.identifier);
    expect(proof.signatures.attestorAddress).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  });

  test('passes headers to the gateway', async () => {
    await requestProof(GATEWAY_URL, {
      url: 'https://api.example.com/price',
      method: 'GET',
      headers: { 'x-api-key': 'secret' },
    });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsed = JSON.parse(options.body as string) as { headers: Record<string, string> };
    expect(parsed.headers).toEqual({ 'x-api-key': 'secret' });
  });

  test('throws on non-ok gateway response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      text: () => Promise.resolve('Bad Gateway'),
    });

    const request = requestProof(GATEWAY_URL, { url: 'https://api.example.com/price', method: 'GET' });
    expect(request).rejects.toThrow('Proof gateway returned 502');
    await request.catch(() => {});
  });

  test('throws on network error', async () => {
    fetchMock.mockRejectedValue(new Error('Connection refused'));

    const request = requestProof(GATEWAY_URL, { url: 'https://api.example.com/price', method: 'GET' });
    expect(request).rejects.toThrow('Connection refused');
    await request.catch(() => {});
  });

  test('rejects a proof that attests a different URL than the request', async () => {
    const request = requestProof(GATEWAY_URL, { url: 'https://api.example.com/other', method: 'GET' });
    expect(request).rejects.toThrow('proof attests URL');
    await request.catch(() => {});
  });

  test('rejects a proof whose claim parameters are not valid JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          claim: { parameters: 'not-json' },
          signatures: { claimSignature: '0xabc', attestorAddress: '0xdef' },
        }),
    });

    const request = requestProof(GATEWAY_URL, { url: 'https://api.example.com/price', method: 'GET' });
    expect(request).rejects.toThrow('not valid JSON');
    await request.catch(() => {});
  });

  test('rejects a proof missing the attestor signature', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ claim: { parameters: '{"url":"https://api.example.com/price","method":"GET"}' } }),
    });

    const request = requestProof(GATEWAY_URL, { url: 'https://api.example.com/price', method: 'GET' });
    expect(request).rejects.toThrow('missing attestor signature');
    await request.catch(() => {});
  });
});
