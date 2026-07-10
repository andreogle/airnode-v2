import { describe, expect, test } from 'bun:test';
import { keccak256, toHex } from 'viem';
import { deriveEndpointId } from '../../src/endpoint';
import type { Api, Endpoint } from '../../src/types';

function makeApi(url = 'https://api.example.com'): Api {
  return { name: 'Test', url, timeout: 10_000, endpoints: [] };
}

function makeEndpoint(overrides: Partial<Endpoint> = {}): Endpoint {
  return { name: 'test', path: '/data', method: 'GET', parameters: [], ...overrides } as Endpoint;
}

describe('S6 — Secret parameter handling in endpoint IDs', () => {
  test('secret parameter semantics affect the endpoint ID without exposing the value', () => {
    const api = makeApi();
    const withSecret = makeEndpoint({
      parameters: [{ name: 'apiKey', in: 'header', required: true, secret: true, fixed: 'my-key' }],
    });
    const rotated = makeEndpoint({
      parameters: [{ name: 'apiKey', in: 'header', required: true, secret: true, fixed: 'rotated-key' }],
    });
    const without = makeEndpoint();

    expect(deriveEndpointId(api, withSecret)).toBe(deriveEndpointId(api, rotated));
    expect(deriveEndpointId(api, withSecret)).not.toBe(deriveEndpointId(api, without));
  });

  test('env-var fixed value is represented as a secret parameter marker', () => {
    const api = makeApi();
    const withEnv = makeEndpoint({
      parameters: [{ name: 'apiKey', in: 'header', required: true, secret: false, fixed: '${API_KEY}' }],
    });
    const without = makeEndpoint();

    expect(deriveEndpointId(api, withEnv)).not.toBe(deriveEndpointId(api, without));
  });

  test('non-secret fixed parameter DOES affect the endpoint ID', () => {
    const api = makeApi();
    const withFixed = makeEndpoint({
      parameters: [{ name: 'currency', in: 'query', required: false, secret: false, fixed: 'usd' }],
    });
    const without = makeEndpoint();

    expect(deriveEndpointId(api, withFixed)).not.toBe(deriveEndpointId(api, without));
  });

  test('fixed value is included in the canonical string', () => {
    const api = makeApi();
    const endpoint = makeEndpoint({
      parameters: [{ name: 'coin', in: 'query', required: false, secret: false, fixed: 'bitcoin' }],
    });

    const id = deriveEndpointId(api, endpoint);
    expect(id).toBe(
      keccak256(
        toHex(
          'https://api.example.com|/data|GET|[{"name":"coin","in":"query","required":false,"secret":false,"fixed":"bitcoin"}]'
        )
      )
    );
  });
});
