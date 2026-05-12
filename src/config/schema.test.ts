import { describe, expect, test } from 'bun:test';
import { parse } from 'yaml';
import { configSchema, encryptSchema, parameterSchema } from './schema';

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

  test('rejects a non-numeric x402 amount', () => {
    const raw = MINIMAL_CONFIG.replace(
      'url: https://api.example.com',
      `url: https://api.example.com
    auth:
      type: x402
      network: 8453
      rpc: https://mainnet.base.org
      token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
      amount: '1 USDC'
      recipient: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'`
    );
    expect(() => configSchema.parse(parseYaml(raw))).toThrow();

    const withDecimal = raw.replace("amount: '1 USDC'", "amount: '1.5'");
    expect(() => configSchema.parse(parseYaml(withDecimal))).toThrow();
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

  test('strips unknown cache keys', () => {
    const raw = MINIMAL_CONFIG.replace(
      'path: /test',
      `path: /test
        cache:
          maxAge: 5000
          delay: 60000`
    );
    const result = configSchema.parse(parseYaml(raw));
    expect(result.apis[0]?.endpoints[0]?.cache).toEqual({ maxAge: 5000 });
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

  test('parses reclaim-proof example config successfully', async () => {
    const file = Bun.file(`${import.meta.dirname}/../../examples/configs/reclaim-proof/config.yaml`);
    const content = await file.text();
    const result = configSchema.parse(parseYaml(content));

    expect(result.version).toBe('1.0');
    expect(result.apis).toHaveLength(1);
    expect(result.settings.proof).toEqual({
      type: 'reclaim',
      gatewayUrl: 'http://localhost:5177/v1/prove',
      timeout: 30_000,
    });
    expect(result.apis[0]?.endpoints[0]?.responseMatches).toEqual([
      { type: 'regex', value: String.raw`"usd":\s*(?<price>[\d.]+)` },
    ]);
  });

  test('parses fhe-encrypt example config successfully', async () => {
    const file = Bun.file(`${import.meta.dirname}/../../examples/configs/fhe-encrypt/config.yaml`);
    const content = await file.text();
    const result = configSchema.parse(parseYaml(content));

    expect(result.version).toBe('1.0');
    expect(result.settings.fhe).toEqual({
      network: 'sepolia',
      rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
      verifier: '0x0000000000000000000000000000000000000000',
    });
    expect(result.apis[0]?.endpoints[0]?.encrypt).toEqual({
      type: 'euint256',
      contract: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    });
  });
});

// =============================================================================
// FHE encryption
// =============================================================================
const FHE_CONFIG = `
version: '1.0'
server:
  port: 3000
settings:
  fhe:
    network: sepolia
    rpcUrl: https://eth-sepolia.example.com
    verifier: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
apis:
  - name: Test
    url: https://api.example.com
    endpoints:
      - name: price
        path: /price
        encoding:
          type: int256
          path: $.price
        encrypt:
          type: euint256
          contract: '0x5FbDB2315678afecb367f032d93F642f64180aa3'
`;

describe('fhe settings', () => {
  test('defaults to none', () => {
    const result = configSchema.parse(parseYaml(MINIMAL_CONFIG));
    expect(result.settings.fhe).toBe('none');
  });

  test('accepts a relayer connection', () => {
    const result = configSchema.parse(parseYaml(FHE_CONFIG));
    expect(result.settings.fhe).toEqual({
      network: 'sepolia',
      rpcUrl: 'https://eth-sepolia.example.com',
      verifier: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    });
  });

  test('accepts an optional apiKey', () => {
    const raw = FHE_CONFIG.replace(
      "    verifier: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'",
      "    verifier: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'\n    apiKey: my-relayer-key"
    );
    const result = configSchema.parse(parseYaml(raw));
    expect((result.settings.fhe as { apiKey: string }).apiKey).toBe('my-relayer-key');
  });

  test('rejects an unknown network', () => {
    expect(() => configSchema.parse(parseYaml(FHE_CONFIG.replace('network: sepolia', 'network: goerli')))).toThrow();
  });

  test('rejects an invalid rpcUrl', () => {
    expect(() =>
      configSchema.parse(parseYaml(FHE_CONFIG.replace('rpcUrl: https://eth-sepolia.example.com', 'rpcUrl: not-a-url')))
    ).toThrow();
  });

  test('rejects an invalid verifier address', () => {
    expect(() =>
      configSchema.parse(
        parseYaml(FHE_CONFIG.replace("verifier: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'", "verifier: '0xabc'"))
      )
    ).toThrow();
  });

  test('rejects a missing verifier', () => {
    expect(() =>
      configSchema.parse(
        parseYaml(FHE_CONFIG.replace("\n    verifier: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'", ''))
      )
    ).toThrow();
  });

  test('rejects an encrypt endpoint when fhe is none', () => {
    const raw = FHE_CONFIG.replace(
      "  fhe:\n    network: sepolia\n    rpcUrl: https://eth-sepolia.example.com\n    verifier: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'",
      '  fhe: none'
    );
    expect(() => configSchema.parse(parseYaml(raw))).toThrow('settings.fhe');
  });
});

describe('encrypt', () => {
  test('accepts an encrypt block on an endpoint with integer encoding', () => {
    const result = configSchema.parse(parseYaml(FHE_CONFIG));
    expect(result.apis[0]?.endpoints[0]?.encrypt).toEqual({
      type: 'euint256',
      contract: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    });
  });

  test('rejects encrypt without an encoding block', () => {
    const raw = FHE_CONFIG.replace('        encoding:\n          type: int256\n          path: $.price\n', '');
    expect(() => configSchema.parse(parseYaml(raw))).toThrow('encrypt');
  });

  test('rejects encrypt when encoding.type is not int256 or uint256', () => {
    expect(() => configSchema.parse(parseYaml(FHE_CONFIG.replace('type: int256', 'type: bytes32')))).toThrow('encrypt');
  });

  test('rejects encrypt when encoding.path is missing', () => {
    const raw = FHE_CONFIG.replace('          path: $.price\n', '');
    expect(() => configSchema.parse(parseYaml(raw))).toThrow('encrypt');
  });

  test('rejects an unknown ciphertext type', () => {
    expect(() => configSchema.parse(parseYaml(FHE_CONFIG.replace('type: euint256', 'type: euint17')))).toThrow();
  });

  test('rejects an invalid contract address', () => {
    expect(() =>
      configSchema.parse(
        parseYaml(FHE_CONFIG.replace("contract: '0x5FbDB2315678afecb367f032d93F642f64180aa3'", "contract: '0xnope'"))
      )
    ).toThrow();
  });

  test('encryptSchema accepts valid input', () => {
    const result = encryptSchema.parse({ type: 'euint64', contract: '0x5FbDB2315678afecb367f032d93F642f64180aa3' });
    expect(result.type).toBe('euint64');
  });

  test('encryptSchema rejects an unknown type', () => {
    expect(() =>
      encryptSchema.parse({ type: 'euint512', contract: '0x5FbDB2315678afecb367f032d93F642f64180aa3' })
    ).toThrow();
  });
});

describe('proof settings', () => {
  test('accepts proof: none (string)', () => {
    const result = configSchema.parse(parseYaml(MINIMAL_CONFIG));
    expect(result.settings.proof).toBe('none');
  });

  test('accepts proof: reclaim with gatewayUrl, defaulting timeout', () => {
    const raw = MINIMAL_CONFIG.replace(
      'proof: none',
      `proof:
    type: reclaim
    gatewayUrl: https://prove.example.com/v1/prove`
    );
    const result = configSchema.parse(parseYaml(raw));
    const proof = result.settings.proof as { type: string; gatewayUrl: string; timeout: number };
    expect(proof.type).toBe('reclaim');
    expect(proof.gatewayUrl).toBe('https://prove.example.com/v1/prove');
    expect(proof.timeout).toBe(30_000);
  });

  test('accepts a custom proof timeout', () => {
    const raw = MINIMAL_CONFIG.replace(
      'proof: none',
      `proof:
    type: reclaim
    gatewayUrl: https://prove.example.com/v1/prove
    timeout: 5000`
    );
    const result = configSchema.parse(parseYaml(raw));
    expect((result.settings.proof as { timeout: number }).timeout).toBe(5000);
  });

  test('rejects reclaim proof without gatewayUrl', () => {
    const raw = MINIMAL_CONFIG.replace(
      'proof: none',
      `proof:
    type: reclaim`
    );
    expect(() => configSchema.parse(parseYaml(raw))).toThrow();
  });

  test('rejects invalid gatewayUrl', () => {
    const raw = MINIMAL_CONFIG.replace(
      'proof: none',
      `proof:
    type: reclaim
    gatewayUrl: not-a-url`
    );
    expect(() => configSchema.parse(parseYaml(raw))).toThrow();
  });
});

describe('parameterSchema', () => {
  test('rejects required parameter with a default value', () => {
    expect(() => parameterSchema.parse({ name: 'q', required: true, default: 'usd' })).toThrow(
      'A parameter cannot be both required and have a default value'
    );
  });

  test('accepts required parameter without a default', () => {
    const result = parameterSchema.parse({ name: 'q', required: true });
    expect(result.required).toBe(true);
  });

  test('accepts optional parameter with a default', () => {
    const result = parameterSchema.parse({ name: 'q', default: 'usd' });
    expect(result.required).toBe(false);
    expect(result.default).toBe('usd');
  });
});
