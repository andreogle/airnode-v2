import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { encodeAbiParameters } from 'viem';
import { encryptResponse, resetFheInstance } from './fhe';

// =============================================================================
// Mocked relayer SDK
//
// `src/fhe.ts` imports `@zama-fhe/relayer-sdk/node` dynamically (lazily), so this
// `mock.module` call — though it runs after the `import` above is hoisted — is
// in place by the time `encryptResponse` actually triggers the dynamic import.
// =============================================================================
const SEPOLIA_PRESET = { relayerUrl: 'https://relayer.testnet.zama.cloud', aclContractAddress: '0xACLsepolia' };
const MAINNET_PRESET = { relayerUrl: 'https://relayer.mainnet.zama.cloud', aclContractAddress: '0xACLmainnet' };

let createInstanceConfigs: unknown[] = [];

let encryptedInputArgs: { readonly contract: string; readonly user: string }[] = [];

let addCalls: { readonly method: string; readonly value: bigint }[] = [];

let mockHandle: Uint8Array = new Uint8Array(32).fill(0x11);

let mockProof: Uint8Array = new Uint8Array([0x22, 0x22, 0x22, 0x22]);

let mockEmptyHandles = false;

function makeBuilder(): Record<string, unknown> {
  const record = (method: string) => (value: bigint) => {
    addCalls.push({ method, value });
    return builder;
  };
  const builder: Record<string, unknown> = {
    add8: record('add8'),
    add16: record('add16'),
    add32: record('add32'),
    add64: record('add64'),
    add128: record('add128'),
    add256: record('add256'),
    encrypt: () => Promise.resolve({ handles: mockEmptyHandles ? [] : [mockHandle], inputProof: mockProof }),
  };
  return builder;
}

void mock.module('@zama-fhe/relayer-sdk/node', () => ({
  SepoliaConfig: SEPOLIA_PRESET,
  MainnetConfig: MAINNET_PRESET,
  createInstance: (config: unknown) => {
    createInstanceConfigs.push(config);
    return Promise.resolve({
      createEncryptedInput: (contract: string, user: string) => {
        encryptedInputArgs.push({ contract, user });
        return makeBuilder();
      },
    });
  },
}));

// =============================================================================
// Fixtures
// =============================================================================
const CONTRACT = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const VERIFIER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const RPC_URL = 'https://ethereum-sepolia-rpc.publicnode.com';
const SEPOLIA = { network: 'sepolia' as const, rpcUrl: RPC_URL, verifier: VERIFIER };

function encodedInt256(value: bigint): `0x${string}` {
  return encodeAbiParameters([{ type: 'int256' }], [value]);
}

// abi.encode(bytes32 0x1111…11, bytes 0x22222222) with the fixtures above:
// 32-byte handle word, offset word (0x40), length word (4), then the 4 proof
// bytes right-padded to a full word.
const EXPECTED_PACKED: `0x${string}` =
  '0x1111111111111111111111111111111111111111111111111111111111111111000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000042222222200000000000000000000000000000000000000000000000000000000';

describe('encryptResponse', () => {
  beforeEach(() => {
    createInstanceConfigs = [];
    encryptedInputArgs = [];
    addCalls = [];
    mockHandle = new Uint8Array(32).fill(0x11);
    mockProof = new Uint8Array([0x22, 0x22, 0x22, 0x22]);
    mockEmptyHandles = false;
    resetFheInstance();
  });

  afterEach(() => {
    resetFheInstance();
  });

  test('packs abi.encode(bytes32 handle, bytes inputProof)', async () => {
    const result = await encryptResponse(
      SEPOLIA,
      { type: 'euint256', contract: CONTRACT },
      encodedInt256(123n),
      'int256'
    );
    expect(result).toBe(EXPECTED_PACKED);
  });

  test('binds the encrypted input to (contract, verifier)', async () => {
    await encryptResponse(SEPOLIA, { type: 'euint256', contract: CONTRACT }, encodedInt256(1n), 'int256');
    expect(encryptedInputArgs).toEqual([{ contract: CONTRACT, user: VERIFIER }]);
  });

  test.each([
    ['euint8', 'add8'],
    ['euint16', 'add16'],
    ['euint32', 'add32'],
    ['euint64', 'add64'],
    ['euint128', 'add128'],
    ['euint256', 'add256'],
  ] as const)('encrypt.type %s packs the value via %s', async (type, method) => {
    await encryptResponse(SEPOLIA, { type, contract: CONTRACT }, encodedInt256(42n), 'int256');
    expect(addCalls).toEqual([{ method, value: 42n }]);
  });

  test('throws if the encoding type does not decode to an integer', () => {
    const encodedBool = encodeAbiParameters([{ type: 'bool' }], [true]);
    expect(encryptResponse(SEPOLIA, { type: 'euint256', contract: CONTRACT }, encodedBool, 'bool')).rejects.toThrow(
      'decode to a bigint'
    );
  });

  test('decodes a uint256 value above 2^255 as a positive bigint', async () => {
    const big = 2n ** 255n + 7n;
    const encoded = encodeAbiParameters([{ type: 'uint256' }], [big]);
    await encryptResponse(SEPOLIA, { type: 'euint256', contract: CONTRACT }, encoded, 'uint256');
    expect(addCalls).toEqual([{ method: 'add256', value: big }]);
  });

  test('rejects a negative encoded value', () => {
    expect(
      encryptResponse(SEPOLIA, { type: 'euint256', contract: CONTRACT }, encodedInt256(-1n), 'int256')
    ).rejects.toThrow('negative');
  });

  test('rejects a value that does not fit in the chosen type', () => {
    expect(
      encryptResponse(SEPOLIA, { type: 'euint8', contract: CONTRACT }, encodedInt256(256n), 'int256')
    ).rejects.toThrow('does not fit in euint8');
  });

  test('rejects when the relayer returns no handles', () => {
    mockEmptyHandles = true;
    expect(
      encryptResponse(SEPOLIA, { type: 'euint256', contract: CONTRACT }, encodedInt256(1n), 'int256')
    ).rejects.toThrow('no handles');
  });

  test('rejects when the handle is not 32 bytes', () => {
    mockHandle = new Uint8Array(16).fill(0x11);
    expect(
      encryptResponse(SEPOLIA, { type: 'euint256', contract: CONTRACT }, encodedInt256(1n), 'int256')
    ).rejects.toThrow('expected 32');
  });

  test('builds the relayer config from the sepolia preset plus the rpc url', async () => {
    await encryptResponse(SEPOLIA, { type: 'euint256', contract: CONTRACT }, encodedInt256(1n), 'int256');
    expect(createInstanceConfigs).toEqual([{ ...SEPOLIA_PRESET, network: RPC_URL }]);
  });

  test('uses the mainnet preset when network is mainnet', async () => {
    await encryptResponse(
      { network: 'mainnet', rpcUrl: RPC_URL, verifier: VERIFIER },
      { type: 'euint256', contract: CONTRACT },
      encodedInt256(1n),
      'int256'
    );
    expect(createInstanceConfigs).toEqual([{ ...MAINNET_PRESET, network: RPC_URL }]);
  });

  test('attaches ApiKeyHeader auth when apiKey is set', async () => {
    await encryptResponse(
      { ...SEPOLIA, apiKey: 'secret-key' },
      { type: 'euint256', contract: CONTRACT },
      encodedInt256(1n),
      'int256'
    );
    expect(createInstanceConfigs).toEqual([
      { ...SEPOLIA_PRESET, network: RPC_URL, auth: { __type: 'ApiKeyHeader', value: 'secret-key' } },
    ]);
  });

  test('reuses the cached instance across calls with the same connection', async () => {
    await encryptResponse(SEPOLIA, { type: 'euint256', contract: CONTRACT }, encodedInt256(1n), 'int256');
    await encryptResponse(SEPOLIA, { type: 'euint256', contract: CONTRACT }, encodedInt256(2n), 'int256');
    expect(createInstanceConfigs).toHaveLength(1);
  });

  test('re-creates the instance after resetFheInstance', async () => {
    await encryptResponse(SEPOLIA, { type: 'euint256', contract: CONTRACT }, encodedInt256(1n), 'int256');
    resetFheInstance();
    await encryptResponse(SEPOLIA, { type: 'euint256', contract: CONTRACT }, encodedInt256(2n), 'int256');
    expect(createInstanceConfigs).toHaveLength(2);
  });
});
