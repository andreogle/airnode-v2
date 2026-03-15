---
slug: /consumers/on-chain
sidebar_position: 2
---

# On-Chain Integration

Airnode provides two on-chain contracts for consuming signed data. Both are permissionless -- anyone can submit signed
data, and the contracts verify the airnode's signature.

## Pull path: AirnodeVerifier

The pull path is for one-shot data delivery. You fetch signed data from the airnode's HTTP server and submit it to the
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

### When to use pull

- Your dApp needs data on demand (user-initiated actions like swaps, mints, settlements).
- You want to pay gas only when data is actually consumed.
- You need arbitrary data types beyond a single `int224` value.

## Push path: AirnodeDataFeed

The push path is for continuous data feeds. A relayer reads signed data from the airnode's HTTP server and pushes it
on-chain. Your contract reads the latest value at any time without making HTTP calls.

### Consumer contract

Read the latest value by calling `read_beacon()` with a known beacon ID.

```solidity
interface IAirnodeDataFeed {
  function read_beacon(bytes32 beaconId) external view returns (int224 value, uint32 timestamp);
}

contract MyProtocol {
  IAirnodeDataFeed public feed;
  bytes32 public beaconId;

  constructor(address _feed, bytes32 _beaconId) {
    feed = IAirnodeDataFeed(_feed);
    beaconId = _beaconId;
  }

  function getPrice() external view returns (int224) {
    (int224 value, uint32 timestamp) = feed.read_beacon(beaconId);
    require(value > 0, 'Invalid');
    require(timestamp + 24 hours > block.timestamp, 'Stale');
    return value;
  }
}
```

### Beacon IDs

A beacon is a single data point from a single airnode for a single endpoint.

```
beaconId = keccak256(encodePacked(airnodeAddress, endpointId))
```

Two independent airnodes serving the same endpoint produce different beacon IDs (different airnode addresses) but the
same endpoint ID (same API specification).

You can derive a beacon ID on-chain or off-chain:

```solidity
// On-chain (AirnodeDataFeed has a pure helper)
bytes32 beaconId = dataFeed.derive_beacon_id(airnodeAddress, endpointId);
```

```typescript
// Off-chain (viem)
import { keccak256, encodePacked } from 'viem';
const beaconId = keccak256(encodePacked(['address', 'bytes32'], [airnodeAddress, endpointId]));
```

### Beacon sets

A beacon set aggregates multiple beacons into a single feed using median aggregation. This gives you a robust price from
multiple independent airnodes.

```
beaconSetId = keccak256(abi.encode(beaconIds))
```

Beacon sets are read with the same `read_beacon()` function -- both beacons and beacon sets are stored in the same
mapping.

### Data format

All feeds use 18 decimals and store values as `int224`. ETH at $3000.50 is stored as `3000500000000000000000`. Values
are packed with a `uint32` timestamp into a single storage slot.

### When to use push

- Your contract needs a continuously updated price feed.
- Multiple consumers read the same data (amortize gas across readers).
- You need on-chain data availability without off-chain infrastructure.

## Choosing between pull and push

| Aspect         | Pull (AirnodeVerifier)          | Push (AirnodeDataFeed)            |
| -------------- | ------------------------------- | --------------------------------- |
| Data delivery  | On demand, per request          | Continuous, relayer-driven        |
| Data size      | Up to 4KB, any ABI-encoded type | 32 bytes, single `int224`         |
| Gas cost       | Paid per submission             | Paid per update, reads are free   |
| Freshness      | Real-time (fetched on demand)   | Depends on relayer update cadence |
| Infrastructure | Off-chain client required       | Relayer required                  |
