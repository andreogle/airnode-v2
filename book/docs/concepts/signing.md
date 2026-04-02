---
slug: /concepts/signing
sidebar_position: 4
---

# Signing and Verification

Every response from Airnode is signed with the operator's private key using EIP-191. The signature proves that a
specific airnode produced specific data for a specific endpoint at a specific time. Consumers can verify the signature
off-chain or submit it to an on-chain contract for verification.

## Signature Format

```
hash = keccak256(encodePacked(endpointId, timestamp, data))
signature = EIP-191 personal sign over hash
```

The three fields are ABI-packed with their types:

| Field        | Type      | Description                                              |
| ------------ | --------- | -------------------------------------------------------- |
| `endpointId` | `bytes32` | The endpoint this data belongs to                        |
| `timestamp`  | `uint256` | Unix timestamp (seconds) when the data was signed        |
| `data`       | `bytes`   | ABI-encoded response data, or keccak256 hash of raw JSON |

### Why separate fields

The `endpointId`, `timestamp`, and `data` are packed as separate fields -- not nested inside another hash. This is a
deliberate design choice:

- **On-chain contracts** can decode the packed data and inspect each field independently. A freshness check can reject
  data with a stale timestamp. An endpoint filter can reject data for an unexpected endpoint.
- **TLS proof verification** can match the endpoint ID against the observed HTTP request without needing to reconstruct
  a nested hash structure.
- **Simplicity** -- the signed message is a single `keccak256(encodePacked(...))`, which maps directly to how Solidity
  and Vyper compute hashes with `abi.encodePacked`.

### Raw responses

For endpoints without encoding, Airnode returns the full JSON in a `rawData` field. The signature covers the keccak256
hash of the JSON-serialized response:

```
dataHash = keccak256(toHex(JSON.stringify(rawData)))
hash = keccak256(encodePacked(endpointId, timestamp, dataHash))
signature = EIP-191 personal sign over hash
```

The consumer receives both `rawData` (the full JSON) and `signature` (over the hash of that JSON). To verify, hash the
raw data yourself and check it against the signature.

## Off-Chain Verification

Verify a signed response using viem:

```typescript
import { verifyMessage, keccak256, encodePacked } from 'viem';

const response = {
  airnode: '0xd1e98F3Ac20DA5e4da874723517c914a31b0e857',
  endpointId: '0xa1b2...endpoint-id-hash',
  timestamp: 1711234567,
  data: '0x00000000...encoded-data',
  signature: '0x1234...65-byte-signature',
};

// Reconstruct the message hash
const messageHash = keccak256(
  encodePacked(['bytes32', 'uint256', 'bytes'], [response.endpointId, BigInt(response.timestamp), response.data])
);

// Verify the signature recovers to the expected airnode address
const valid = await verifyMessage({
  address: response.airnode,
  message: { raw: messageHash },
  signature: response.signature,
});

console.log(valid); // true
```

For raw responses, compute `dataHash` first:

```typescript
import { keccak256, toHex } from 'viem';

const dataHash = keccak256(toHex(JSON.stringify(response.rawData)));
const messageHash = keccak256(
  encodePacked(['bytes32', 'uint256', 'bytes'], [response.endpointId, BigInt(response.timestamp), dataHash])
);
```

## On-Chain Verification

On-chain contracts verify signatures using `ecrecover` with the EIP-191 prefix. The `AirnodeVerifier` contract verifies
signed data:

```solidity
// Pseudocode -- actual implementation is in Vyper
hash = keccak256(abi.encodePacked(endpointId, timestamp, data))
prefixed = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash))
signer = ecrecover(prefixed, v, r, s)
require(signer == airnode)
```

The EIP-191 prefix (`\x19Ethereum Signed Message:\n32`) is applied automatically by the `personal_sign` method. Both the
off-chain signer (viem's `signMessage`) and the on-chain verifier (snekmate's `message_hash_utils`) apply the same
prefix, so signatures are interoperable.

## Timestamp

The `timestamp` field is the Unix timestamp (in seconds) at the moment Airnode signs the response. It serves two
purposes:

**Freshness** -- consumers can reject data that is too old. An on-chain contract can enforce a maximum age (e.g., reject
data older than 5 minutes). A client can compare the timestamp to the current time and decide whether to use the data.

**Replay protection** -- the timestamp is part of the signed hash. The same data signed at a different time produces a
different signature. On-chain contracts can enforce that new updates have a more recent timestamp than the stored value,
preventing replay of stale data.

The timestamp is set by the airnode, not by the client. A client cannot request data "as of" a specific time -- the
timestamp always reflects when the airnode processed the request.
