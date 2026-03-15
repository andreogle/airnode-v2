import { describe, expect, test } from 'bun:test';
import { keccak256, toHex } from 'viem';
import { deriveEndpointId } from '../../src/endpoint';
import type { Api, Endpoint } from '../../src/types';

function makeApi(url = 'https://api.example.com'): Api {
  return { name: 'Test', url, timeout: 10_000, endpoints: [] } as Api;
}

function makeEndpoint(overrides: Partial<Endpoint> = {}): Endpoint {
  return { name: 'test', path: '/data', method: 'GET', parameters: [], ...overrides } as Endpoint;
}

describe('S6 — Secret parameter exclusion from endpoint ID', () => {
  test('secret: true parameter does not affect the endpoint ID', () => {
    const api = makeApi();
    const withSecret = makeEndpoint({
      parameters: [{ name: 'apiKey', in: 'header', required: true, secret: true, fixed: 'my-key' }],
    });
    const without = makeEndpoint();

    expect(deriveEndpointId(api, withSecret)).toBe(deriveEndpointId(api, without));
  });

  test('env-var fixed value (${...}) does not affect the endpoint ID', () => {
    const api = makeApi();
    const withEnv = makeEndpoint({
      parameters: [{ name: 'apiKey', in: 'header', required: true, secret: false, fixed: '${API_KEY}' }],
    });
    const without = makeEndpoint();

    expect(deriveEndpointId(api, withEnv)).toBe(deriveEndpointId(api, without));
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
    expect(id).toBe(keccak256(toHex('https://api.example.com|/data|GET|coin=bitcoin')));
  });
});
