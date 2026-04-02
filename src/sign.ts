import { type Hex, encodePacked, keccak256 } from 'viem';
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts';

// =============================================================================
// Types
// =============================================================================
interface SignedResponse {
  readonly signature: Hex;
  readonly airnode: Hex;
}

// =============================================================================
// Account creation (call once at startup, not per-request)
// =============================================================================
function createAirnodeAccount(privateKey: Hex): PrivateKeyAccount {
  return privateKeyToAccount(privateKey);
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

export { createAirnodeAccount, deriveMessageHash, signResponse };
export type { SignedResponse };
