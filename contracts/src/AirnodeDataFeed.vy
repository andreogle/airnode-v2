# @version ^0.4.0
# @title AirnodeDataFeed
# @notice Stores and serves Airnode-signed data feeds (beacons). This is the
#         on-chain primitive for the "push" path — a relayer reads signed data
#         from an Airnode HTTP server and pushes it on-chain so consumer contracts
#         can read the latest value at any time.
#
#   How it works:
#   1. An Airnode signs a data point: (endpointId, timestamp, data).
#   2. A relayer calls update_beacon() with the signed data.
#   3. This contract verifies the signature, checks the timestamp is newer than
#      the stored value, and stores the update.
#   4. Consumer contracts call read_beacon() to get the latest value.
#
#   Beacons and beacon sets:
#   - A beacon is a single data feed from a single airnode for a single endpoint.
#     beacon_id = keccak256(encodePacked(airnode, endpoint_id))
#   - A beacon set aggregates multiple beacons via on-chain median. Useful for
#     robust prices from multiple independent airnodes serving the same data.
#     beacon_set_id = keccak256(abi.encode(beacon_ids))
#
#   Signature format:
#     hash = keccak256(encodePacked(endpointId, timestamp, data))
#     signature = EIP-191 personal sign over hash
#
#   Trust model:
#   - Permissionless: anyone can push a valid signed update.
#   - Timestamp monotonicity: updates must have a strictly newer timestamp.
#   - Timestamps more than 1 hour in the future are rejected.
#   - Data is (int224, uint32) per beacon — matching API3 data feed format.
#   - Data parameter must be exactly 32 bytes encoding an int256 within int224 range.

from snekmate.utils import ecdsa as ec
from snekmate.utils import message_hash_utils as mhu

# ==============================================================================
# Events
# ==============================================================================
event BeaconUpdated:
    beacon_id: indexed(bytes32)
    value: int224
    timestamp: uint32

event BeaconSetUpdated:
    beacon_set_id: indexed(bytes32)
    value: int224
    timestamp: uint32

# ==============================================================================
# Storage
# ==============================================================================
struct DataFeed:
    value: int224
    timestamp: uint32

beacons: public(HashMap[bytes32, DataFeed])

# ==============================================================================
# Constants
# ==============================================================================
DATA_LENGTH: constant(uint256) = 32
MAX_BEACON_SET_SIZE: constant(uint256) = 21
# 5 minutes — handles realistic clock drift without allowing far-future timestamps
# that could lock a beacon via timestamp monotonicity
MAX_FUTURE_TIMESTAMP: constant(uint256) = 300

# ==============================================================================
# External functions
# ==============================================================================
@external
def update_beacon(
    airnode: address,
    endpoint_id: bytes32,
    timestamp: uint256,
    data: Bytes[DATA_LENGTH],
    signature: Bytes[65],
) -> bytes32:
    """
    @notice Update a beacon with signed data from an airnode.
    @param airnode The airnode address that signed the data.
    @param endpoint_id The specification-bound endpoint ID.
    @param timestamp The timestamp of the data point.
    @param data The ABI-encoded value (int256 in 32 bytes).
    @param signature The EIP-191 personal signature.
    @return beacon_id The ID of the updated beacon.
    """
    # Verify signature
    message_hash: bytes32 = keccak256(
        concat(endpoint_id, convert(timestamp, bytes32), data)
    )
    eth_signed_hash: bytes32 = mhu._to_eth_signed_message_hash(message_hash)
    recovered: address = ec._recover_sig(eth_signed_hash, signature)
    assert recovered == airnode, "Signature mismatch"

    # Derive beacon ID
    beacon_id: bytes32 = keccak256(concat(convert(airnode, bytes20), endpoint_id))

    # Validate timestamp
    assert timestamp < block.timestamp + MAX_FUTURE_TIMESTAMP, "Timestamp too far in future"
    assert timestamp > convert(self.beacons[beacon_id].timestamp, uint256), "Does not update timestamp"

    # Decode and validate the value
    assert len(data) == 32, "Data length not correct"
    decoded: int256 = convert(convert(data, bytes32), int256)
    assert decoded >= convert(min_value(int224), int256), "Value below int224 min"
    assert decoded <= convert(max_value(int224), int256), "Value above int224 max"

    # Store
    self.beacons[beacon_id] = DataFeed(
        value=convert(decoded, int224),
        timestamp=convert(timestamp, uint32),
    )

    log BeaconUpdated(
        beacon_id=beacon_id,
        value=convert(decoded, int224),
        timestamp=convert(timestamp, uint32),
    )

    return beacon_id

@external
def update_beacon_set(beacon_ids: DynArray[bytes32, MAX_BEACON_SET_SIZE]) -> bytes32:
    """
    @notice Update a beacon set by computing the median of its constituent beacons.
    @param beacon_ids The IDs of the beacons to aggregate.
    @return beacon_set_id The ID of the updated beacon set.
    """
    count: uint256 = len(beacon_ids)
    assert count >= 2, "Need at least 2 beacons"

    # Collect values and timestamps
    values: DynArray[int256, MAX_BEACON_SET_SIZE] = []
    timestamps: DynArray[uint256, MAX_BEACON_SET_SIZE] = []

    for i: uint256 in range(MAX_BEACON_SET_SIZE):
        if i >= count:
            break
        beacon: DataFeed = self.beacons[beacon_ids[i]]
        assert beacon.timestamp > 0, "Beacon not initialized"
        values.append(convert(beacon.value, int256))
        timestamps.append(convert(beacon.timestamp, uint256))

    # Compute medians
    median_value: int224 = convert(self._median(values), int224)
    median_timestamp: uint32 = convert(self._median_uint(timestamps), uint32)

    # Derive beacon set ID
    beacon_set_id: bytes32 = keccak256(abi_encode(beacon_ids))

    # Only update if the value or timestamp changed
    stored: DataFeed = self.beacons[beacon_set_id]
    if stored.timestamp == median_timestamp:
        assert stored.value != median_value, "Does not update beacon set"

    self.beacons[beacon_set_id] = DataFeed(
        value=median_value,
        timestamp=median_timestamp,
    )

    log BeaconSetUpdated(
        beacon_set_id=beacon_set_id,
        value=median_value,
        timestamp=median_timestamp,
    )

    return beacon_set_id

@view
@external
def read_beacon(beacon_id: bytes32) -> (int224, uint32):
    """
    @notice Read the latest value and timestamp for a beacon or beacon set.
    @param beacon_id The beacon ID (or beacon set ID).
    @return value The latest int224 value.
    @return timestamp The timestamp of the last update.
    """
    feed: DataFeed = self.beacons[beacon_id]
    assert feed.timestamp > 0, "Data feed not initialized"
    return (feed.value, feed.timestamp)

@pure
@external
def derive_beacon_id(airnode: address, endpoint_id: bytes32) -> bytes32:
    """
    @notice Derive the beacon ID from an airnode address and endpoint ID.
    @param airnode The airnode address.
    @param endpoint_id The endpoint ID.
    @return beacon_id The derived beacon ID.
    """
    return keccak256(concat(convert(airnode, bytes20), endpoint_id))

@pure
@external
def derive_beacon_set_id(beacon_ids: DynArray[bytes32, MAX_BEACON_SET_SIZE]) -> bytes32:
    """
    @notice Derive the beacon set ID from constituent beacon IDs.
    @param beacon_ids The beacon IDs.
    @return beacon_set_id The derived beacon set ID.
    """
    return keccak256(abi_encode(beacon_ids))

# ==============================================================================
# Internal — median computation via insertion sort
# ==============================================================================
@pure
@internal
def _median(values: DynArray[int256, MAX_BEACON_SET_SIZE]) -> int256:
    """
    @notice Compute the median of int256 values via insertion sort.
    """
    count: uint256 = len(values)
    sorted: DynArray[int256, MAX_BEACON_SET_SIZE] = values

    for i: uint256 in range(1, MAX_BEACON_SET_SIZE):
        if i >= count:
            break
        key: int256 = sorted[i]
        j: uint256 = i
        for _k: uint256 in range(MAX_BEACON_SET_SIZE):
            if j == 0:
                break
            if sorted[j - 1] <= key:
                break
            sorted[j] = sorted[j - 1]
            j = j - 1
        sorted[j] = key

    return sorted[(count - 1) // 2]

@pure
@internal
def _median_uint(values: DynArray[uint256, MAX_BEACON_SET_SIZE]) -> uint256:
    """
    @notice Compute the median of uint256 values via insertion sort.
    """
    count: uint256 = len(values)
    sorted: DynArray[uint256, MAX_BEACON_SET_SIZE] = values

    for i: uint256 in range(1, MAX_BEACON_SET_SIZE):
        if i >= count:
            break
        key: uint256 = sorted[i]
        j: uint256 = i
        for _k: uint256 in range(MAX_BEACON_SET_SIZE):
            if j == 0:
                break
            if sorted[j - 1] <= key:
                break
            sorted[j] = sorted[j - 1]
            j = j - 1
        sorted[j] = key

    return sorted[(count - 1) // 2]
