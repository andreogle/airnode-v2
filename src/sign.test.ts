import { describe, expect, test } from 'bun:test';
import { type Hex, encodePacked, hashMessage, keccak256 } from 'viem';
import { recoverAddress } from 'viem';
import { createAirnodeAccount, createAirnodeAccountFromMnemonic, deriveMessageHash, signResponse } from './sign';

const TEST_PRIVATE_KEY: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
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
    const mnemonic = 'test test test test test test test test test test test junk';
    const account = createAirnodeAccountFromMnemonic(mnemonic);
    expect(account.address).toMatch(/^0x[\dA-Fa-f]{40}$/);
  });

  test('mnemonic account can sign and verify round-trip', async () => {
    const mnemonic = 'test test test test test test test test test test test junk';
    const account = createAirnodeAccountFromMnemonic(mnemonic);
    const result = await signResponse(account, ENDPOINT_ID, TIMESTAMP, DATA);

    const messageHash = deriveMessageHash(ENDPOINT_ID, TIMESTAMP, DATA);
    const recovered = await recoverAddress({
      hash: hashMessage({ raw: messageHash }),
      signature: result.signature,
    });

    expect(recovered).toBe(account.address);
  });
});
