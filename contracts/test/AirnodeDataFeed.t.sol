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

  function update_beacon_set(bytes32[] calldata beacon_ids) external returns (bytes32);

  function read_beacon(bytes32 beacon_id) external view returns (int224, uint32);
  function derive_beacon_id(address airnode, bytes32 endpoint_id) external pure returns (bytes32);
  function derive_beacon_set_id(bytes32[] calldata beacon_ids) external pure returns (bytes32);
}

contract AirnodeDataFeedTest is VyperDeploy {
  IAirnodeDataFeed feed;

  uint256 constant AIRNODE_KEY_1 = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
  uint256 constant AIRNODE_KEY_2 = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
  address airnode1;
  address airnode2;

  bytes32 constant ENDPOINT_ID = bytes32(uint256(1));
  uint256 constant TIMESTAMP = 1_700_000_000;

  function setUp() public {
    feed = IAirnodeDataFeed(deployVyper('AirnodeDataFeed'));
    airnode1 = vm.addr(AIRNODE_KEY_1);
    airnode2 = vm.addr(AIRNODE_KEY_2);
    vm.warp(TIMESTAMP + 100);
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  function _sign(
    uint256 privateKey,
    bytes32 endpointId,
    uint256 timestamp,
    bytes memory data
  ) internal pure returns (bytes memory) {
    bytes32 messageHash = keccak256(abi.encodePacked(endpointId, timestamp, data));
    bytes32 ethSignedHash = keccak256(abi.encodePacked('\x19Ethereum Signed Message:\n32', messageHash));
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, ethSignedHash);
    return abi.encodePacked(r, s, v);
  }

  function _encodeValue(int256 value) internal pure returns (bytes memory) {
    return abi.encode(value);
  }

  function _updateBeacon(
    uint256 key,
    address airnode,
    bytes32 endpointId,
    uint256 timestamp,
    int256 value
  ) internal returns (bytes32) {
    bytes memory data = _encodeValue(value);
    bytes memory sig = _sign(key, endpointId, timestamp, data);
    return feed.update_beacon(airnode, endpointId, timestamp, data, sig);
  }

  // ===========================================================================
  // update_beacon
  // ===========================================================================

  function test_updates_beacon_with_valid_signature() public {
    bytes32 beaconId = _updateBeacon(AIRNODE_KEY_1, airnode1, ENDPOINT_ID, TIMESTAMP, 3000e18);

    (int224 value, uint32 ts) = feed.read_beacon(beaconId);
    assertEq(value, int224(3000e18));
    assertEq(ts, uint32(TIMESTAMP));
  }

  function test_returns_correct_beacon_id() public {
    bytes32 beaconId = _updateBeacon(AIRNODE_KEY_1, airnode1, ENDPOINT_ID, TIMESTAMP, 3000e18);
    bytes32 expected = feed.derive_beacon_id(airnode1, ENDPOINT_ID);
    assertEq(beaconId, expected);
  }

  function test_updates_beacon_with_newer_timestamp() public {
    _updateBeacon(AIRNODE_KEY_1, airnode1, ENDPOINT_ID, TIMESTAMP, 3000e18);

    bytes32 beaconId = _updateBeacon(AIRNODE_KEY_1, airnode1, ENDPOINT_ID, TIMESTAMP + 10, 3100e18);

    (int224 value, uint32 ts) = feed.read_beacon(beaconId);
    assertEq(value, int224(3100e18));
    assertEq(ts, uint32(TIMESTAMP + 10));
  }

  function test_reverts_on_stale_timestamp() public {
    _updateBeacon(AIRNODE_KEY_1, airnode1, ENDPOINT_ID, TIMESTAMP, 3000e18);

    bytes memory data = _encodeValue(2900e18);
    bytes memory sig = _sign(AIRNODE_KEY_1, ENDPOINT_ID, TIMESTAMP - 1, data);

    vm.expectRevert('Does not update timestamp');
    feed.update_beacon(airnode1, ENDPOINT_ID, TIMESTAMP - 1, data, sig);
  }

  function test_reverts_on_same_timestamp() public {
    _updateBeacon(AIRNODE_KEY_1, airnode1, ENDPOINT_ID, TIMESTAMP, 3000e18);

    bytes memory data = _encodeValue(3100e18);
    bytes memory sig = _sign(AIRNODE_KEY_1, ENDPOINT_ID, TIMESTAMP, data);

    vm.expectRevert('Does not update timestamp');
    feed.update_beacon(airnode1, ENDPOINT_ID, TIMESTAMP, data, sig);
  }

  function test_reverts_on_future_timestamp() public {
    uint256 futureTs = block.timestamp + 301;
    bytes memory data = _encodeValue(3000e18);
    bytes memory sig = _sign(AIRNODE_KEY_1, ENDPOINT_ID, futureTs, data);

    vm.expectRevert('Timestamp too far in future');
    feed.update_beacon(airnode1, ENDPOINT_ID, futureTs, data, sig);
  }

  function test_reverts_on_wrong_signature() public {
    bytes memory data = _encodeValue(3000e18);
    bytes memory sig = _sign(AIRNODE_KEY_2, ENDPOINT_ID, TIMESTAMP, data);

    vm.expectRevert('Signature mismatch');
    feed.update_beacon(airnode1, ENDPOINT_ID, TIMESTAMP, data, sig);
  }

  function test_reverts_on_value_out_of_int224_range() public {
    int256 tooBig = int256(type(int224).max) + 1;
    bytes memory data = _encodeValue(tooBig);
    bytes memory sig = _sign(AIRNODE_KEY_1, ENDPOINT_ID, TIMESTAMP, data);

    vm.expectRevert('Value above int224 max');
    feed.update_beacon(airnode1, ENDPOINT_ID, TIMESTAMP, data, sig);
  }

  function test_reverts_reading_uninitialized_beacon() public {
    bytes32 beaconId = feed.derive_beacon_id(airnode1, ENDPOINT_ID);
    vm.expectRevert('Data feed not initialized');
    feed.read_beacon(beaconId);
  }

  function test_negative_values() public {
    bytes32 beaconId = _updateBeacon(AIRNODE_KEY_1, airnode1, ENDPOINT_ID, TIMESTAMP, -500e18);

    (int224 value, ) = feed.read_beacon(beaconId);
    assertEq(value, int224(-500e18));
  }

  // ===========================================================================
  // update_beacon_set
  // ===========================================================================

  function test_updates_beacon_set_with_median() public {
    bytes32 endpointId2 = bytes32(uint256(2));

    // Airnode 1 reports 3000, Airnode 2 reports 3100, Airnode 1 on endpoint 2 reports 3050
    bytes32 b1 = _updateBeacon(AIRNODE_KEY_1, airnode1, ENDPOINT_ID, TIMESTAMP, 3000e18);
    bytes32 b2 = _updateBeacon(AIRNODE_KEY_2, airnode2, ENDPOINT_ID, TIMESTAMP, 3100e18);
    bytes32 b3 = _updateBeacon(AIRNODE_KEY_1, airnode1, endpointId2, TIMESTAMP, 3050e18);

    bytes32[] memory beaconIds = new bytes32[](3);
    beaconIds[0] = b1;
    beaconIds[1] = b2;
    beaconIds[2] = b3;

    bytes32 setId = feed.update_beacon_set(beaconIds);

    (int224 value, uint32 ts) = feed.read_beacon(setId);
    // Median of [3000, 3050, 3100] = 3050
    assertEq(value, int224(3050e18));
    assertEq(ts, uint32(TIMESTAMP));
  }

  function test_beacon_set_with_two_beacons() public {
    bytes32 b1 = _updateBeacon(AIRNODE_KEY_1, airnode1, ENDPOINT_ID, TIMESTAMP, 3000e18);
    bytes32 b2 = _updateBeacon(AIRNODE_KEY_2, airnode2, ENDPOINT_ID, TIMESTAMP + 10, 3200e18);

    bytes32[] memory beaconIds = new bytes32[](2);
    beaconIds[0] = b1;
    beaconIds[1] = b2;

    bytes32 setId = feed.update_beacon_set(beaconIds);

    (int224 value, uint32 ts) = feed.read_beacon(setId);
    // Median of [3000, 3200] with even count = lower-middle = 3000
    assertEq(value, int224(3000e18));
    // Median timestamp of [TIMESTAMP, TIMESTAMP+10] = TIMESTAMP
    assertEq(ts, uint32(TIMESTAMP));
  }

  function test_beacon_set_reverts_with_fewer_than_two() public {
    bytes32 b1 = _updateBeacon(AIRNODE_KEY_1, airnode1, ENDPOINT_ID, TIMESTAMP, 3000e18);

    bytes32[] memory beaconIds = new bytes32[](1);
    beaconIds[0] = b1;

    vm.expectRevert('Need at least 2 beacons');
    feed.update_beacon_set(beaconIds);
  }

  function test_beacon_set_reverts_with_uninitialized_beacon() public {
    bytes32 b1 = _updateBeacon(AIRNODE_KEY_1, airnode1, ENDPOINT_ID, TIMESTAMP, 3000e18);
    bytes32 uninitializedId = feed.derive_beacon_id(airnode2, ENDPOINT_ID);

    bytes32[] memory beaconIds = new bytes32[](2);
    beaconIds[0] = b1;
    beaconIds[1] = uninitializedId;

    vm.expectRevert('Beacon not initialized');
    feed.update_beacon_set(beaconIds);
  }

  function test_beacon_set_id_derivation() public {
    bytes32[] memory beaconIds = new bytes32[](2);
    beaconIds[0] = bytes32(uint256(1));
    beaconIds[1] = bytes32(uint256(2));

    bytes32 setId = feed.derive_beacon_set_id(beaconIds);
    assertEq(setId, keccak256(abi.encode(beaconIds)));
  }

  // ===========================================================================
  // derive_beacon_id
  // ===========================================================================

  function test_beacon_id_is_deterministic() public view {
    bytes32 id1 = feed.derive_beacon_id(airnode1, ENDPOINT_ID);
    bytes32 id2 = feed.derive_beacon_id(airnode1, ENDPOINT_ID);
    assertEq(id1, id2);
  }

  function test_different_airnodes_produce_different_beacon_ids() public view {
    bytes32 id1 = feed.derive_beacon_id(airnode1, ENDPOINT_ID);
    bytes32 id2 = feed.derive_beacon_id(airnode2, ENDPOINT_ID);
    assertTrue(id1 != id2);
  }

  function test_different_endpoints_produce_different_beacon_ids() public view {
    bytes32 id1 = feed.derive_beacon_id(airnode1, bytes32(uint256(1)));
    bytes32 id2 = feed.derive_beacon_id(airnode1, bytes32(uint256(2)));
    assertTrue(id1 != id2);
  }
}
