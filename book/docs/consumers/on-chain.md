---
slug: /consumers/on-chain
sidebar_position: 2
---

# On-Chain Integration

Airnode provides an on-chain contract for consuming signed data. The contract is permissionless -- anyone can submit
signed data, and it verifies the airnode's signature.

## AirnodeVerifier

The verifier is for one-shot data delivery. You fetch signed data from the airnode's HTTP server and submit it to the
AirnodeVerifier contract, which verifies the signature and forwards the data to your callback contract.

### Flow

1. Your off-chain client calls the airnode HTTP endpoint and receives signed data.
2. Your client calls `verify_and_fulfill()` on AirnodeVerifier with the signed data and your callback address.
3. AirnodeVerifier recovers the signer, checks replay protection, and calls your callback.
4. Your callback receives the data and acts on it.

### Consumer contract

Your contract receives the callback and decides what to do with the data. At minimum, verify that you trust the airnode
address.

```solidity
contract MyConsumer {
  address public trustedAirnode;

  constructor(address _airnode) {
    trustedAirnode = _airnode;
  }

  function fulfill(
    bytes32, // requestHash (unique per submission)
    address airnode, // the signer's address
    bytes32, // endpointId
    uint256, // timestamp
    bytes calldata data
  ) external {
    require(airnode == trustedAirnode, 'Untrusted');
    int256 price = abi.decode(data, (int256));
    // use price
  }
}
```

The `requestHash` is `keccak256(endpointId, timestamp, data)` and serves as the replay key. Each unique combination can
only be fulfilled once.

### When to use

- Your dApp needs data on demand (user-initiated actions like swaps, mints, settlements).
- You want to pay gas only when data is actually consumed.
- You need arbitrary data types beyond a single `int224` value.
