// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { VyperDeploy } from './VyperDeploy.sol';

interface IAirnodeDataFeed {
  function update_beacon(
    address airnode,
    bytes32 endpoint_id,
    uint256 timestamp,
    bytes calldata data,
    bytes calldata signature
  ) external returns (bytes32);

  function read_beacon(bytes32 beacon_id) external view returns (int224, uint32);
  function derive_beacon_id(address airnode, bytes32 endpoint_id) external pure returns (bytes32);
}

/// @notice Symbolic tests for AirnodeDataFeed. Run with Halmos.
///         These prove properties hold for ALL possible inputs.
contract AirnodeDataFeedSymbolicTest is VyperDeploy {
  IAirnodeDataFeed feed;

  uint256 constant AIRNODE_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
  address airnodeAddress;

  function setUp() public {
    feed = IAirnodeDataFeed(deployVyper('AirnodeDataFeed'));
    airnodeAddress = vm.addr(AIRNODE_KEY);
    vm.warp(1_700_000_100);
  }

  function _sign(bytes32 endpointId, uint256 timestamp, bytes memory data) internal pure returns (bytes memory) {
    bytes32 messageHash = keccak256(abi.encodePacked(endpointId, timestamp, data));
    bytes32 ethSignedHash = keccak256(abi.encodePacked('\x19Ethereum Signed Message:\n32', messageHash));
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(AIRNODE_KEY, ethSignedHash);
    return abi.encodePacked(r, s, v);
  }

  /// @notice For any valid update, the stored timestamp equals the update timestamp
  function check_stored_timestamp_equals_update(bytes32 endpointId, uint256 timestamp, int224 value) public {
    vm.assume(timestamp > 0 && timestamp < block.timestamp + 300);

    int256 boundedValue = int256(value);
    bytes memory data = abi.encode(boundedValue);
    bytes memory sig = _sign(endpointId, timestamp, data);

    bytes32 beaconId = feed.update_beacon(airnodeAddress, endpointId, timestamp, data, sig);

    (, uint32 storedTs) = feed.read_beacon(beaconId);
    assert(uint256(storedTs) == timestamp);
  }

  /// @notice For any valid update, the stored value equals the update value
  function check_stored_value_equals_update(bytes32 endpointId, uint256 timestamp, int224 value) public {
    vm.assume(timestamp > 0 && timestamp < block.timestamp + 300);

    int256 boundedValue = int256(value);
    bytes memory data = abi.encode(boundedValue);
    bytes memory sig = _sign(endpointId, timestamp, data);

    bytes32 beaconId = feed.update_beacon(airnodeAddress, endpointId, timestamp, data, sig);

    (int224 storedValue, ) = feed.read_beacon(beaconId);
    assert(storedValue == value);
  }

  /// @notice Stale timestamp always reverts — for any t2 <= t1, the second update fails
  function check_stale_timestamp_reverts(bytes32 endpointId, uint256 t1, uint256 t2) public {
    vm.assume(t1 > 0 && t1 < block.timestamp + 299);
    vm.assume(t2 <= t1);

    int256 val1 = int256(1000e18);
    int256 val2 = int256(2000e18);

    bytes memory data1 = abi.encode(val1);
    bytes memory sig1 = _sign(endpointId, t1, data1);
    feed.update_beacon(airnodeAddress, endpointId, t1, data1, sig1);

    bytes memory data2 = abi.encode(val2);
    bytes memory sig2 = _sign(endpointId, t2, data2);

    try feed.update_beacon(airnodeAddress, endpointId, t2, data2, sig2) {
      assert(false); // Should not succeed
    } catch {
      assert(true); // Expected revert
    }
  }

  /// @notice Beacon ID derivation is deterministic — same inputs always produce same output
  function check_beacon_id_deterministic(address airnode, bytes32 endpointId) public view {
    bytes32 id1 = feed.derive_beacon_id(airnode, endpointId);
    bytes32 id2 = feed.derive_beacon_id(airnode, endpointId);
    assert(id1 == id2);
  }

  /// @notice Different airnodes always produce different beacon IDs for the same endpoint
  function check_different_airnodes_different_ids(address airnode1, address airnode2, bytes32 endpointId) public view {
    vm.assume(airnode1 != airnode2);
    bytes32 id1 = feed.derive_beacon_id(airnode1, endpointId);
    bytes32 id2 = feed.derive_beacon_id(airnode2, endpointId);
    assert(id1 != id2);
  }
}
