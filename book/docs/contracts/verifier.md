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
3. If the signer matches the provided Airnode address and this exact callback delivery has not run before, the data is
   forwarded to the callback contract.
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
  uint256 timestamp, // when Airnode signed the data
  bytes calldata data // the ABI-encoded response
) external;
```

## Replay protection

The `requestHash` is the message hash from the signature. Replay protection is scoped to the signer, payload, callback
address, and callback selector. The same signed payload can be delivered once to each distinct callback target.

The public `fulfilled(airnode, requestHash)` mapping records whether a signer and payload have been delivered anywhere.
The contract uses a separate `fulfilledDelivery` mapping to prevent duplicate delivery to the same callback.

## Trust model

- **Permissionless.** Anyone can submit signed data -- client, relayer, or the airnode itself. The contract does not
  care who pays gas.
- **No airnode registry.** The contract does not know which airnodes are legitimate. It only verifies the math: "did
  this address sign this data?" The callback contract is responsible for checking whether it trusts the airnode address.
- **Callback failure is safe.** If the callback reverts, the fulfillment is still recorded and the event is emitted. The
  submitter's transaction succeeds. This prevents a malicious callback from blocking fulfillment.

## Consumer contract example

Your callback is public, so checking only the Airnode address is unsafe. At minimum, verify the caller, signer,
endpoint, and timestamp before decoding data:

```solidity
contract MyConsumer {
  address public immutable verifier;
  address public immutable trustedAirnode;
  bytes32 public immutable trustedEndpointId;
  int256 public lastPrice;

  constructor(address _verifier, address _airnode, bytes32 _endpointId) {
    verifier = _verifier;
    trustedAirnode = _airnode;
    trustedEndpointId = _endpointId;
  }

  function fulfill(
    bytes32, // requestHash (unused here)
    address airnode,
    bytes32 endpointId,
    uint256 timestamp,
    bytes calldata data
  ) external {
    require(msg.sender == verifier, 'Untrusted verifier');
    require(airnode == trustedAirnode, 'Untrusted airnode');
    require(endpointId == trustedEndpointId, 'Unexpected endpoint');
    require(timestamp <= block.timestamp && block.timestamp - timestamp <= 5 minutes, 'Stale timestamp');
    lastPrice = abi.decode(data, (int256));
  }
}
```

Production consumers should also decide how to handle repeated or out-of-order updates. See
[On-chain integration](/docs/consumers/on-chain) for a complete example.
