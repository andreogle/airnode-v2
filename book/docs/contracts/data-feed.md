---
slug: /contracts/data-feed
sidebar_position: 3
---

# AirnodeDataFeed

Stores and serves signed data feeds. This is the on-chain primitive for the push path -- a relayer reads signed data
from the airnode's HTTP server and pushes it on-chain so other contracts can read the latest value at any time.

## Beacons

A **beacon** is a single data point from a single airnode for a single endpoint.

```
beacon_id = keccak256(encodePacked(airnode_address, endpoint_id))
```

Two independent airnodes serving the same endpoint produce different beacon IDs (different airnode address) but the same
endpoint ID (same API spec). A beacon stores `(int224 value, uint32 timestamp)` -- one storage slot.

## Beacon sets

A **beacon set** is a median aggregation of multiple beacons. Useful for getting a robust price from multiple
independent airnodes.

```
beacon_set_id = keccak256(abi.encode(beacon_ids))
```

## Functions

### Updating

```vyper
update_beacon(
    airnode: address,       # the signer
    endpoint_id: bytes32,   # endpoint hash
    timestamp: uint256,     # data timestamp
    data: Bytes[32],        # ABI-encoded int256 (must be within int224 range)
    signature: Bytes[65],   # EIP-191 personal signature
) -> bytes32               # returns the beacon_id
```

```vyper
update_beacon_set(
    beacon_ids: DynArray[bytes32, 21]  # constituent beacon IDs (2-21)
) -> bytes32                           # returns the beacon_set_id
```

### Reading

```vyper
read_beacon(beacon_id: bytes32) -> (int224, uint32)  # value, timestamp
```

Beacons and beacon sets are read with the same function -- both are stored in the same mapping.

### Derivation (pure, no state)

```vyper
derive_beacon_id(airnode: address, endpoint_id: bytes32) -> bytes32
derive_beacon_set_id(beacon_ids: DynArray[bytes32, 21]) -> bytes32
```

## Data constraints

- **Data must be exactly 32 bytes** -- one ABI-encoded `int256`.
- **Value must fit in `int224`** -- the range is roughly +/-1.3 x 10^67. This matches the API3 data feed format and
  packs value + timestamp into a single storage slot.
- **Timestamps must increase** -- an update with a timestamp equal to or older than the stored value is rejected. This
  prevents stale data from overwriting fresh data.
- **Timestamps can't be more than 5 minutes in the future** -- handles clock drift while preventing far-future timestamp
  attacks that could lock a beacon via timestamp monotonicity.
- **All feeds use 18 decimals** -- ETH at $3000.50 is stored as `3000500000000000000000`.

## Median aggregation

Beacon sets compute the median of their constituent beacon values and timestamps. The median is calculated via insertion
sort, which is efficient for the small arrays involved (max 21 beacons). The lower-middle element is chosen for even
counts.

A beacon set update:

1. Reads all constituent beacons (all must be initialized).
2. Sorts values, takes the median.
3. Sorts timestamps, takes the median.
4. Stores the result under the beacon set ID.
5. Reverts if the result is identical to the currently stored value (no-op protection).

## Trust model

- **Permissionless updates.** Anyone can push a valid signed update. The contract only checks the airnode's signature.
- **No airnode registry.** The contract does not decide which airnodes are trustworthy. The consumer chooses which
  beacon IDs to read -- that choice is their trust decision.
- **Timestamp monotonicity.** Each beacon's timestamp can only increase. A relayer cannot overwrite fresh data with
  stale data, even with a valid signature.

## Consumer contract example

```solidity
interface IAirnodeDataFeed {
  function read_beacon(bytes32 beaconId) external view returns (int224 value, uint32 timestamp);
}

contract MyDeFiProtocol {
  IAirnodeDataFeed public dataFeed;
  bytes32 public ethUsdBeaconId;

  constructor(address _feed, bytes32 _beaconId) {
    dataFeed = IAirnodeDataFeed(_feed);
    ethUsdBeaconId = _beaconId;
  }

  function getPrice() external view returns (int224) {
    (int224 value, uint32 timestamp) = dataFeed.read_beacon(ethUsdBeaconId);
    require(value > 0, 'Invalid price');
    require(timestamp + 24 hours > block.timestamp, 'Stale price');
    return value;
  }
}
```
