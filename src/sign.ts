import { goSync } from '@api3/promise-utils';
import { type Hex, encodePacked, keccak256 } from 'viem';
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts';
import { mnemonicToAccount } from 'viem/accounts';

// =============================================================================
// Types
// =============================================================================
interface SignedResponse {
  readonly signature: Hex;
  readonly airnode: Hex;
}

type ResolvedAccount =
  | { readonly success: true; readonly account: PrivateKeyAccount }
  | { readonly success: false; readonly error: string };

// =============================================================================
// Account creation (call once at startup, not per-request)
// =============================================================================
function createAirnodeAccount(privateKey: Hex): PrivateKeyAccount {
  return privateKeyToAccount(privateKey);
}

function createAirnodeAccountFromMnemonic(mnemonic: string): PrivateKeyAccount {
  return mnemonicToAccount(mnemonic) as unknown as PrivateKeyAccount;
}

const PRIVATE_KEY_REGEX = /^0x[\da-fA-F]{64}$/;

// Resolve the airnode signing account from the environment. `AIRNODE_MNEMONIC`
// takes precedence over `AIRNODE_PRIVATE_KEY`. Returns a clear, actionable error
// rather than letting a malformed key blow up deep inside viem at sign time.
function accountFromEnv(env: NodeJS.ProcessEnv = process.env): ResolvedAccount {
  const mnemonic = env['AIRNODE_MNEMONIC'];
  if (mnemonic) {
    const result = goSync(() => createAirnodeAccountFromMnemonic(mnemonic));
    if (!result.success) {
      return { success: false, error: `AIRNODE_MNEMONIC is not a valid BIP-39 mnemonic: ${result.error.message}` };
    }
    return { success: true, account: result.data };
  }

  const privateKey = env['AIRNODE_PRIVATE_KEY'];
  if (privateKey) {
    if (!PRIVATE_KEY_REGEX.test(privateKey)) {
      return { success: false, error: 'AIRNODE_PRIVATE_KEY must be a 0x-prefixed 32-byte hex string (66 characters)' };
    }
    const result = goSync(() => createAirnodeAccount(privateKey as Hex));
    if (!result.success) return { success: false, error: `AIRNODE_PRIVATE_KEY is invalid: ${result.error.message}` };
    return { success: true, account: result.data };
  }

  return { success: false, error: 'AIRNODE_PRIVATE_KEY or AIRNODE_MNEMONIC environment variable is required' };
}

// =============================================================================
// Signing
//
// Signature format matches the on-chain contract (AirnodeVerifier):
//   hash = keccak256(encodePacked(endpointId, timestamp, data))
//   signature = EIP-191 personal sign over hash
//
// The endpointId, timestamp, and data are separate fields so on-chain contracts
// can inspect each one independently (e.g. for TLS proof verification or
// freshness checks).
// =============================================================================
function deriveMessageHash(endpointId: Hex, timestamp: number, data: Hex): Hex {
  return keccak256(encodePacked(['bytes32', 'uint256', 'bytes'], [endpointId, BigInt(timestamp), data]));
}

async function signResponse(
  account: PrivateKeyAccount,
  endpointId: Hex,
  timestamp: number,
  data: Hex
): Promise<SignedResponse> {
  const messageHash = deriveMessageHash(endpointId, timestamp, data);
  const signature = await account.signMessage({ message: { raw: messageHash } });
  return { signature, airnode: account.address };
}

export { accountFromEnv, createAirnodeAccount, createAirnodeAccountFromMnemonic, deriveMessageHash, signResponse };
export type { ResolvedAccount, SignedResponse };
