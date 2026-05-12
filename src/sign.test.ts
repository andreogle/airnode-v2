import { describe, expect, test } from 'bun:test';
import { type Hex, encodePacked, hashMessage, keccak256 } from 'viem';
import { recoverAddress } from 'viem';
import {
  accountFromEnv,
  createAirnodeAccount,
  createAirnodeAccountFromMnemonic,
  deriveMessageHash,
  signResponse,
} from './sign';

const TEST_PRIVATE_KEY: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const TEST_MNEMONIC = 'test test test test test test test test test test test junk'; // derives TEST_ADDRESS
const TEST_ACCOUNT = createAirnodeAccount(TEST_PRIVATE_KEY);

const ENDPOINT_ID: Hex = '0x04e77a11d6561a70385e2e8e315989cb24bb35128cb4d5a8b3ece93a3c72295b';
const TIMESTAMP = 1_700_000_000;
const DATA: Hex = '0xdeadbeef';

describe('deriveMessageHash', () => {
  test('produces deterministic output', () => {
    const hash1 = deriveMessageHash(ENDPOINT_ID, TIMESTAMP, DATA);
    const hash2 = deriveMessageHash(ENDPOINT_ID, TIMESTAMP, DATA);
    expect(hash1).toBe(hash2);
  });

  test('matches keccak256(encodePacked(endpointId, timestamp, data))', () => {
    const hash = deriveMessageHash(ENDPOINT_ID, TIMESTAMP, DATA);
    const expected = keccak256(encodePacked(['bytes32', 'uint256', 'bytes'], [ENDPOINT_ID, BigInt(TIMESTAMP), DATA]));
    expect(hash).toBe(expected);
  });

  test('different timestamps produce different hashes', () => {
    const hash1 = deriveMessageHash(ENDPOINT_ID, TIMESTAMP, DATA);
    const hash2 = deriveMessageHash(ENDPOINT_ID, TIMESTAMP + 1, DATA);
    expect(hash1).not.toBe(hash2);
  });
});

describe('signResponse', () => {
  test('returns valid signature and correct airnode address', async () => {
    const result = await signResponse(TEST_ACCOUNT, ENDPOINT_ID, TIMESTAMP, DATA);

    expect(result.airnode).toBe(TEST_ADDRESS);
    expect(result.signature).toMatch(/^0x[0-9a-f]{130}$/);
  });

  test('sign + recover round-trip matches airnode address', async () => {
    const result = await signResponse(TEST_ACCOUNT, ENDPOINT_ID, TIMESTAMP, DATA);

    const messageHash = deriveMessageHash(ENDPOINT_ID, TIMESTAMP, DATA);
    const recovered = await recoverAddress({
      hash: hashMessage({ raw: messageHash }),
      signature: result.signature,
    });

    expect(recovered).toBe(TEST_ADDRESS);
    expect(recovered).toBe(result.airnode);
  });

  test('createAirnodeAccount derives correct address', () => {
    expect(TEST_ACCOUNT.address).toBe(TEST_ADDRESS);
  });

  test('createAirnodeAccountFromMnemonic derives a valid account', () => {
    const account = createAirnodeAccountFromMnemonic(TEST_MNEMONIC);
    expect(account.address).toBe(TEST_ADDRESS);
  });

  test('mnemonic account can sign and verify round-trip', async () => {
    const account = createAirnodeAccountFromMnemonic(TEST_MNEMONIC);
    const result = await signResponse(account, ENDPOINT_ID, TIMESTAMP, DATA);

    const messageHash = deriveMessageHash(ENDPOINT_ID, TIMESTAMP, DATA);
    const recovered = await recoverAddress({
      hash: hashMessage({ raw: messageHash }),
      signature: result.signature,
    });

    expect(recovered).toBe(account.address);
  });
});

describe('accountFromEnv', () => {
  test('resolves from AIRNODE_PRIVATE_KEY', () => {
    const result = accountFromEnv({ AIRNODE_PRIVATE_KEY: TEST_PRIVATE_KEY });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.account.address).toBe(TEST_ADDRESS);
  });

  test('resolves from AIRNODE_MNEMONIC', () => {
    const result = accountFromEnv({ AIRNODE_MNEMONIC: TEST_MNEMONIC });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.account.address).toBe(TEST_ADDRESS);
  });

  test('AIRNODE_MNEMONIC takes precedence over AIRNODE_PRIVATE_KEY', () => {
    const otherKey: Hex = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'; // a different account
    const result = accountFromEnv({ AIRNODE_MNEMONIC: TEST_MNEMONIC, AIRNODE_PRIVATE_KEY: otherKey });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.account.address).toBe(TEST_ADDRESS);
  });

  test('rejects a private key with the wrong length', () => {
    const result = accountFromEnv({ AIRNODE_PRIVATE_KEY: '0x1234' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe('AIRNODE_PRIVATE_KEY must be a 0x-prefixed 32-byte hex string (66 characters)');
  });

  test('rejects a private key without the 0x prefix', () => {
    const result = accountFromEnv({
      AIRNODE_PRIVATE_KEY: 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain('AIRNODE_PRIVATE_KEY must be');
  });

  test('rejects an invalid mnemonic', () => {
    const result = accountFromEnv({ AIRNODE_MNEMONIC: 'not actually a real bip39 mnemonic phrase here' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain('AIRNODE_MNEMONIC is not a valid BIP-39 mnemonic');
  });

  test('reports a clear error when neither variable is set', () => {
    const result = accountFromEnv({});
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe('AIRNODE_PRIVATE_KEY or AIRNODE_MNEMONIC environment variable is required');
  });
});
