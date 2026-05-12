---
slug: /contracts/verifier
sidebar_position: 2
---

# AirnodeVerifier

Verifies an airnode's signature and forwards the data to a callback contract. This is the on-chain primitive for the
pull path -- a client gets signed data from the HTTP server and submits it to trigger logic in their own contract.

## How it works

1. Anyone calls `verifyAndFulfill()` with signed data and a callback target.
2. The contract recovers the signer from the signature.
3. If the signer matches the provided airnode address, and the data hasn't been submitted before (replay protection),
   the data is forwarded to the callback contract.
4. If the callback reverts, the fulfillment is still recorded. This prevents griefing where a callback intentionally
   reverts to block fulfillment.

## Function

```solidity
function verifyAndFulfill(
    address airnode,          // expected signer
    bytes32 endpointId,       // specification-bound endpoint hash
    uint256 timestamp,        // data timestamp
    bytes calldata data,      // signed payload (opaque bytes — ABI value, FHE ciphertext, or JSON hash)
    bytes calldata signature, // EIP-191 personal signature
    address callbackAddress,  // contract to forward data to
    bytes4 callbackSelector   // function selector on the callback
) external
```

## Callback format

The callback receives five arguments:

```solidity
function fulfill(
  bytes32 requestHash, // keccak256(endpointId, timestamp, data) -- unique per submission
  address airnode, // the signer's address
  bytes32 endpointId, // which API endpoint produced this data
  uint256 timestamp, // when the data was produced
  bytes calldata data // the ABI-encoded response
) external;
```

## Replay protection

The `requestHash` (the `messageHash` from the signature) serves as the replay key. Each unique combination of
`(endpointId, timestamp, data)` can only be fulfilled once. The `fulfilled` mapping is public -- anyone can check
whether a particular hash has been submitted.

## Trust model

- **Permissionless.** Anyone can submit signed data -- client, relayer, or the airnode itself. The contract does not
  care who pays gas.
- **No airnode registry.** The contract does not know which airnodes are legitimate. It only verifies the math: "did
  this address sign this data?" The callback contract is responsible for checking whether it trusts the airnode address.
- **Callback failure is safe.** If the callback reverts, the fulfillment is still recorded and the event is emitted. The
  submitter's transaction succeeds. This prevents a malicious callback from blocking fulfillment.

## Consumer contract example

Your contract receives the callback and decides what to do with the data. At minimum, check that you trust the airnode:

```solidity
contract MyConsumer {
  address public trustedAirnode;
  int256 public lastPrice;

  constructor(address _airnode) {
    trustedAirnode = _airnode;
  }

  function fulfill(
    bytes32, // requestHash (unused here)
    address airnode,
    bytes32, // endpointId (unused here)
    uint256, // timestamp (unused here)
    bytes calldata data
  ) external {
    require(airnode == trustedAirnode, 'Untrusted airnode');
    lastPrice = abi.decode(data, (int256));
  }
}
```
