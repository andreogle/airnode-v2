import { describe, expect, test } from 'bun:test';
import { keccak256, toHex } from 'viem';
import { buildEndpointMap, deriveEndpointId } from './endpoint';
import type { Api, Config, Endpoint } from './types';

// =============================================================================
// Helpers
// =============================================================================
const makeApi = (overrides: Partial<Api> & { url: string; endpoints: Api['endpoints'] }): Api => ({
  name: 'TestAPI',
  timeout: 10_000,
  ...overrides,
});

const makeEndpoint = (overrides: Partial<Endpoint> & { name: string; path: string }): Endpoint => ({
  method: 'GET',
  parameters: [],
  ...overrides,
});

const makeConfig = (apis: readonly Api[]): Config =>
  ({
    version: '1.0',
    apis,
    server: { port: 3000, host: '0.0.0.0' },
    settings: { timeout: 10_000, workers: 4, proof: 'none', plugins: [] },
  }) as unknown as Config;

// =============================================================================
// deriveEndpointId
// =============================================================================
describe('deriveEndpointId', () => {
  test('returns keccak256 of canonical string', () => {
    const api = makeApi({ url: 'https://api.example.com', endpoints: [] });
    const endpoint = makeEndpoint({ name: 'getPrice', path: '/price' });
    const id = deriveEndpointId(api, endpoint);
    expect(id).toBe('0x04e77a11d6561a70385e2e8e315989cb24bb35128cb4d5a8b3ece93a3c72295b');
  });

  test('different APIs with same endpoint name produce different IDs', () => {
    const api1 = makeApi({ url: 'https://api.example.com', endpoints: [] });
    const api2 = makeApi({ url: 'https://other.example.com', endpoints: [] });
    const endpoint = makeEndpoint({ name: 'getPrice', path: '/price' });

    const id1 = deriveEndpointId(api1, endpoint);
    const id2 = deriveEndpointId(api2, endpoint);
    expect(id1).not.toBe(id2);
    expect(id2).toBe('0x7ae17359a66be80e42869c5c41e84705b363158abc60dca8ee014565d8ce110a');
  });

  test('secret parameters (secret: true) are excluded from ID', () => {
    const api = makeApi({ url: 'https://api.example.com', endpoints: [] });
    const withSecret = makeEndpoint({
      name: 'getPrice',
      path: '/price',
      parameters: [{ name: 'apiKey', in: 'header', required: true, secret: true, fixed: 'my-key' }],
    });
    const withoutSecret = makeEndpoint({ name: 'getPrice', path: '/price' });

    expect(deriveEndpointId(api, withSecret)).toBe(deriveEndpointId(api, withoutSecret));
  });

  test('parameters with env-var fixed values (${...}) are excluded from ID', () => {
    const api = makeApi({ url: 'https://api.example.com', endpoints: [] });
    const withEnvVar = makeEndpoint({
      name: 'getPrice',
      path: '/price',
      parameters: [{ name: 'apiKey', in: 'header', required: true, secret: false, fixed: '${API_KEY}' }],
    });
    const plain = makeEndpoint({ name: 'getPrice', path: '/price' });

    expect(deriveEndpointId(api, withEnvVar)).toBe(deriveEndpointId(api, plain));
  });

  test('fixed non-secret parameters include their value in the ID', () => {
    const api = makeApi({ url: 'https://api.example.com', endpoints: [] });
    const withFixed = makeEndpoint({
      name: 'getPrice',
      path: '/price',
      parameters: [{ name: 'coin', in: 'query', required: false, secret: false, fixed: 'bitcoin' }],
    });

    const id = deriveEndpointId(api, withFixed);
    expect(id).toBe('0x9ca06527a73e016eafcc0557cb1c6d336a3a80a5b2b59bfbb9d310c133051f24');
    expect(id).toBe(keccak256(toHex('https://api.example.com|/price|GET|coin=bitcoin')));
  });

  test('parameters are sorted by name (order-independent)', () => {
    const api = makeApi({ url: 'https://api.example.com', endpoints: [] });
    const ordered = makeEndpoint({
      name: 'getPrice',
      path: '/price',
      parameters: [
        { name: 'alpha', in: 'query', required: false, secret: false },
        { name: 'beta', in: 'query', required: false, secret: false, fixed: '123' },
      ],
    });
    const reversed = makeEndpoint({
      name: 'getPrice',
      path: '/price',
      parameters: [
        { name: 'beta', in: 'query', required: false, secret: false, fixed: '123' },
        { name: 'alpha', in: 'query', required: false, secret: false },
      ],
    });

    const id1 = deriveEndpointId(api, ordered);
    const id2 = deriveEndpointId(api, reversed);
    expect(id1).toBe(id2);
    expect(id1).toBe('0x0c2a50ea12738e0fca5ee5c0424446991b47de6853b2983435bfd2331040edbe');
  });

  test('encoding spec changes the endpoint ID', () => {
    const api = makeApi({ url: 'https://api.example.com', endpoints: [] });
    const withEncoding = makeEndpoint({
      name: 'getPrice',
      path: '/price',
      encoding: { type: 'int256', path: '$.price' },
    });
    const withEncodingAndTimes = makeEndpoint({
      name: 'getPrice',
      path: '/price',
      encoding: { type: 'int256', path: '$.price', times: '1e18' },
    });

    const id1 = deriveEndpointId(api, withEncoding);
    const id2 = deriveEndpointId(api, withEncodingAndTimes);
    expect(id1).toBe('0x12a635dd4619e0a165500b7fae7b286bed5ac67f85779e658c14cdf552df53bc');
    expect(id2).toBe('0xd22eb446fcd545f9b2f4beecf8008fedc90fce978aa1d48256dd28bbdce4b171');
    expect(id1).not.toBe(id2);
  });

  test('missing encoding produces different ID than with encoding', () => {
    const api = makeApi({ url: 'https://api.example.com', endpoints: [] });
    const withEncoding = makeEndpoint({
      name: 'getPrice',
      path: '/price',
      encoding: { type: 'int256', path: '$.price' },
    });
    const withoutEncoding = makeEndpoint({ name: 'getPrice', path: '/price' });

    expect(deriveEndpointId(api, withEncoding)).not.toBe(deriveEndpointId(api, withoutEncoding));
  });
});

// =============================================================================
// buildEndpointMap
// =============================================================================
describe('buildEndpointMap', () => {
  test('includes all endpoints from all APIs', () => {
    const api1 = makeApi({
      name: 'API1',
      url: 'https://api1.example.com',
      endpoints: [makeEndpoint({ name: 'getPrice', path: '/price' }), makeEndpoint({ name: 'getTemp', path: '/temp' })],
    });
    const api2 = makeApi({
      name: 'API2',
      url: 'https://api2.example.com',
      endpoints: [makeEndpoint({ name: 'getWeather', path: '/weather' })],
    });

    const config = makeConfig([api1, api2]);
    const map = buildEndpointMap(config);

    expect(map.size).toBe(3);

    const firstEndpoint = api1.endpoints[0];
    if (!firstEndpoint) throw new Error('Expected endpoint');
    const id1 = deriveEndpointId(api1, firstEndpoint);
    const resolved = map.get(id1);
    expect(resolved?.api.name).toBe('API1');
    expect(resolved?.endpoint.name).toBe('getPrice');
  });

  test('returns correct size', () => {
    const api = makeApi({
      url: 'https://api.example.com',
      endpoints: [
        makeEndpoint({ name: 'a', path: '/a' }),
        makeEndpoint({ name: 'b', path: '/b' }),
        makeEndpoint({ name: 'c', path: '/c' }),
      ],
    });

    const config = makeConfig([api]);
    const map = buildEndpointMap(config);
    expect(map.size).toBe(3);
  });
});
