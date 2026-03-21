import { go } from '@api3/promise-utils';
import { type Hex, encodePacked, hashMessage, keccak256, recoverAddress } from 'viem';
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
// Signature format matches the on-chain contracts (AirnodeVerifier, AirnodeDataFeed):
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

// =============================================================================
// Beacon ID derivation
//
// Matches AirnodeDataFeed.vy:
//   beacon_id = keccak256(concat(convert(airnode, bytes20), endpoint_id))
// =============================================================================
function deriveBeaconId(airnode: Hex, endpointId: Hex): Hex {
  return keccak256(encodePacked(['address', 'bytes32'], [airnode, endpointId]));
}

// =============================================================================
// Signature verification
//
// Recovers the signer address from a signed beacon. Used by the cache server
// to verify that incoming data was actually signed by the claimed airnode.
// =============================================================================
async function verifySignedBeacon(
  endpointId: Hex,
  timestamp: number,
  data: Hex,
  signature: Hex
): Promise<Hex | undefined> {
  const messageHash = deriveMessageHash(endpointId, timestamp, data);
  const result = await go(async () => recoverAddress({ hash: hashMessage({ raw: messageHash }), signature }));
  if (!result.success) return undefined;
  return result.data;
}

export { createAirnodeAccount, deriveBeaconId, deriveMessageHash, signResponse, verifySignedBeacon };
export type { SignedResponse };
