import { describe, expect, test } from 'bun:test';
import { parse } from 'yaml';
import { configSchema } from './schema';

function parseYaml(raw: string): unknown {
  return parse(raw) as unknown;
}

const MINIMAL_CONFIG = `
version: '1.0'
server:
  port: 3000
  rateLimit:
    window: 60000
    max: 100
settings:
  proof: none
apis:
  - name: Test
    url: https://api.example.com
    endpoints:
      - name: test
        path: /test
`;

describe('configSchema', () => {
  test('accepts minimal valid config', () => {
    const result = configSchema.parse(parseYaml(MINIMAL_CONFIG));
    expect(result.version).toBe('1.0');
    expect(result.apis).toHaveLength(1);
  });

  test('applies defaults', () => {
    const result = configSchema.parse(parseYaml(MINIMAL_CONFIG));

    expect(result.apis[0]?.endpoints[0]?.method).toBe('GET');
    expect(result.server.host).toBe('0.0.0.0');
    expect(result.server.cors).toBeUndefined();
    expect(result.apis[0]?.timeout).toBe(10_000);
    expect(result.settings.timeout).toBe(10_000);
    expect(result.settings.proof).toBe('none');
  });

  test('rejects missing version', () => {
    const raw = `
server:
  port: 3000
  rateLimit:
    window: 60000
    max: 100
settings:
  proof: none
apis:
  - name: Test
    url: https://api.example.com
    endpoints:
      - name: test
        path: /test
`;
    expect(() => configSchema.parse(parseYaml(raw))).toThrow();
  });

  test('rejects invalid URL', () => {
    const raw = MINIMAL_CONFIG.replace('https://api.example.com', 'not-a-url');
    expect(() => configSchema.parse(parseYaml(raw))).toThrow();
  });

  test('rejects empty apis array', () => {
    const raw = MINIMAL_CONFIG.replace(/apis:[\s\S]*$/, 'apis: []');
    expect(() => configSchema.parse(parseYaml(raw))).toThrow();
  });

  test('rejects missing server', () => {
    const raw = `
version: '1.0'
settings:
  proof: none
apis:
  - name: Test
    url: https://api.example.com
    endpoints:
      - name: test
        path: /test
`;
    expect(() => configSchema.parse(parseYaml(raw))).toThrow();
  });

  test('validates apiKey client auth', () => {
    const raw = MINIMAL_CONFIG.replace(
      'url: https://api.example.com',
      `url: https://api.example.com
    auth:
      type: apiKey
      keys:
        - my-secret-key`
    );
    const result = configSchema.parse(parseYaml(raw));
    expect(result.apis[0]?.auth).toEqual({ type: 'apiKey', keys: ['my-secret-key'] });
  });

  test('validates free client auth', () => {
    const raw = MINIMAL_CONFIG.replace(
      'url: https://api.example.com',
      `url: https://api.example.com
    auth:
      type: free`
    );
    const result = configSchema.parse(parseYaml(raw));
    expect(result.apis[0]?.auth).toEqual({ type: 'free' });
  });

  test('validates nftKey client auth', () => {
    const raw = MINIMAL_CONFIG.replace(
      'url: https://api.example.com',
      `url: https://api.example.com
    auth:
      type: nftKey
      chain: 8453
      rpc: https://mainnet.base.org
      contract: '0x1234567890abcdef1234567890abcdef12345678'`
    );
    const result = configSchema.parse(parseYaml(raw));
    const auth = result.apis[0]?.auth as { type: string; chain: number; contract: string; cacheTtl: number };
    expect(auth.type).toBe('nftKey');
    expect(auth.chain).toBe(8453);
    expect(auth.cacheTtl).toBe(60_000);
  });

  test('validates x402 client auth', () => {
    const raw = MINIMAL_CONFIG.replace(
      'url: https://api.example.com',
      `url: https://api.example.com
    auth:
      type: x402
      network: 8453
      rpc: https://mainnet.base.org
      token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
      amount: '1000000'
      recipient: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'`
    );
    const result = configSchema.parse(parseYaml(raw));
    const auth = result.apis[0]?.auth as { type: string; network: number; amount: string; expiry: number };
    expect(auth.type).toBe('x402');
    expect(auth.network).toBe(8453);
    expect(auth.amount).toBe('1000000');
    expect(auth.expiry).toBe(300_000);
  });

  test('validates auth as array (multi-method)', () => {
    const raw = MINIMAL_CONFIG.replace(
      'url: https://api.example.com',
      `url: https://api.example.com
    auth:
      - type: apiKey
        keys:
          - my-key
      - type: free`
    );
    const result = configSchema.parse(parseYaml(raw));
    expect(result.apis[0]?.auth).toEqual([{ type: 'apiKey', keys: ['my-key'] }, { type: 'free' }]);
  });

  test('validates encoding with type+path+times', () => {
    const raw = MINIMAL_CONFIG.replace(
      'path: /test',
      `path: /test
        encoding:
          type: int256
          path: $.data
          times: '1e18'`
    );
    const result = configSchema.parse(parseYaml(raw));
    expect(result.apis[0]?.endpoints[0]?.encoding).toEqual({
      type: 'int256',
      path: '$.data',
      times: '1e18',
    });
  });

  test('validates encoding with just type+path (times optional)', () => {
    const raw = MINIMAL_CONFIG.replace(
      'path: /test',
      `path: /test
        encoding:
          type: int256
          path: $.data`
    );
    const result = configSchema.parse(parseYaml(raw));
    expect(result.apis[0]?.endpoints[0]?.encoding).toEqual({
      type: 'int256',
      path: '$.data',
    });
  });

  test('validates endpoint-level auth override', () => {
    const raw = MINIMAL_CONFIG.replace(
      'path: /test',
      `path: /test
        auth:
          type: free`
    );
    const result = configSchema.parse(parseYaml(raw));
    expect(result.apis[0]?.endpoints[0]?.auth).toEqual({ type: 'free' });
  });

  test('validates endpoint-level cache override', () => {
    const raw = MINIMAL_CONFIG.replace(
      'path: /test',
      `path: /test
        cache:
          maxAge: 5000`
    );
    const result = configSchema.parse(parseYaml(raw));
    expect(result.apis[0]?.endpoints[0]?.cache).toEqual({ maxAge: 5000 });
  });

  test('validates cache with delay', () => {
    const raw = MINIMAL_CONFIG.replace(
      'path: /test',
      `path: /test
        cache:
          maxAge: 5000
          delay: 60000`
    );
    const result = configSchema.parse(parseYaml(raw));
    expect(result.apis[0]?.endpoints[0]?.cache).toEqual({ maxAge: 5000, delay: 60_000 });
  });

  test('validates parameters with secret flag', () => {
    const raw = MINIMAL_CONFIG.replace(
      'path: /test',
      `path: /test
        parameters:
          - name: apiKey
            in: query
            fixed: mykey
            secret: true`
    );
    const result = configSchema.parse(parseYaml(raw));
    expect(result.apis[0]?.endpoints[0]?.parameters[0]?.secret).toBe(true);
  });

  test('validates fixed parameters', () => {
    const raw = MINIMAL_CONFIG.replace(
      'path: /test',
      `path: /test
        parameters:
          - name: format
            in: query
            fixed: json`
    );
    const result = configSchema.parse(parseYaml(raw));
    expect(result.apis[0]?.endpoints[0]?.parameters[0]?.fixed).toBe('json');
  });

  test('validates body parameters', () => {
    const raw = MINIMAL_CONFIG.replace(
      'path: /test',
      `path: /test
        method: POST
        parameters:
          - name: payload
            in: body
            required: true`
    );
    const result = configSchema.parse(parseYaml(raw));
    expect(result.apis[0]?.endpoints[0]?.parameters[0]?.in).toBe('body');
  });

  test('supports custom timeout per API', () => {
    const raw = MINIMAL_CONFIG.replace(
      'url: https://api.example.com',
      'url: https://api.example.com\n    timeout: 30000'
    );
    const result = configSchema.parse(parseYaml(raw));
    expect(result.apis[0]?.timeout).toBe(30_000);
  });

  test('parses complete example config successfully', async () => {
    const file = Bun.file(`${import.meta.dirname}/../../examples/configs/complete/config.yaml`);
    const content = await file.text();
    const result = configSchema.parse(parseYaml(content));

    expect(result.version).toBe('1.0');
    expect(result.apis).toHaveLength(3);
    expect(result.apis[0]?.auth).toEqual({ type: 'apiKey', keys: ['${CLIENT_API_KEY}'] });
    expect(result.apis[1]?.auth).toEqual({ type: 'free' });
  });

  test('parses minimal example config successfully', async () => {
    const file = Bun.file(`${import.meta.dirname}/../../examples/configs/minimal/config.yaml`);
    const content = await file.text();
    const result = configSchema.parse(parseYaml(content));

    expect(result.version).toBe('1.0');
    expect(result.apis).toHaveLength(1);
    expect(result.apis[0]?.endpoints[0]?.encoding?.type).toBe('int256');
  });
});
