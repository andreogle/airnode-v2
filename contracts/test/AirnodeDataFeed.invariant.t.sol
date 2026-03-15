// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from 'forge-std/Test.sol';
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
}

// =============================================================================
// Handler — bounded operations for the fuzzer
// =============================================================================
contract DataFeedHandler is Test {
  IAirnodeDataFeed public feed;

  uint256 constant AIRNODE_KEY_1 = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
  uint256 constant AIRNODE_KEY_2 = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
  address public airnode1;
  address public airnode2;

  bytes32 constant ENDPOINT_A = bytes32(uint256(1));
  bytes32 constant ENDPOINT_B = bytes32(uint256(2));

  // Ghost state — track the latest timestamp per beacon
  mapping(bytes32 => uint256) public ghost_latestTimestamp;
  uint256 public ghost_updateCount;

  constructor(IAirnodeDataFeed _feed) {
    feed = _feed;
    airnode1 = vm.addr(AIRNODE_KEY_1);
    airnode2 = vm.addr(AIRNODE_KEY_2);
  }

  function updateBeacon(uint8 airnodeSeed, uint256 timestamp, int256 value) external {
    // Pick airnode from fixed set, use a single endpoint for simplicity
    uint256 key = airnodeSeed % 2 == 0 ? AIRNODE_KEY_1 : AIRNODE_KEY_2;
    address airnode = airnodeSeed % 2 == 0 ? airnode1 : airnode2;
    bytes32 beaconId = feed.derive_beacon_id(airnode, ENDPOINT_A);

    // Bound inputs
    timestamp = bound(timestamp, ghost_latestTimestamp[beaconId] + 1, block.timestamp + 299);
    value = bound(value, type(int224).min, type(int224).max);

    bytes memory data = abi.encode(value);
    bytes memory sig = _sign(key, ENDPOINT_A, timestamp, data);

    feed.update_beacon(airnode, ENDPOINT_A, timestamp, data, sig);

    ghost_latestTimestamp[beaconId] = timestamp;
    ghost_updateCount++;
  }

  function _sign(
    uint256 key,
    bytes32 endpointId,
    uint256 timestamp,
    bytes memory data
  ) internal pure returns (bytes memory) {
    bytes32 h = keccak256(abi.encodePacked(endpointId, timestamp, data));
    bytes32 eh = keccak256(abi.encodePacked('\x19Ethereum Signed Message:\n32', h));
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, eh);
    return abi.encodePacked(r, s, v);
  }
}

// =============================================================================
// Invariant test
// =============================================================================
contract AirnodeDataFeedInvariantTest is VyperDeploy {
  IAirnodeDataFeed feed;
  DataFeedHandler handler;

  bytes32 constant ENDPOINT_A = bytes32(uint256(1));

  function setUp() public {
    vm.warp(1_700_000_100);
    feed = IAirnodeDataFeed(deployVyper('AirnodeDataFeed'));
    handler = new DataFeedHandler(feed);
    targetContract(address(handler));
  }

  /// @notice Stored timestamp always matches the ghost's latest timestamp
  function invariant_timestamps_match_ghost() public view {
    _checkBeacon(feed.derive_beacon_id(handler.airnode1(), ENDPOINT_A));
    _checkBeacon(feed.derive_beacon_id(handler.airnode2(), ENDPOINT_A));
  }

  /// @notice Stored timestamp never exceeds block.timestamp + 3600
  function invariant_timestamps_not_too_far_in_future() public view {
    _checkTimestampBound(feed.derive_beacon_id(handler.airnode1(), ENDPOINT_A));
    _checkTimestampBound(feed.derive_beacon_id(handler.airnode2(), ENDPOINT_A));
  }

  function _checkBeacon(bytes32 beaconId) internal view {
    uint256 ghostTs = handler.ghost_latestTimestamp(beaconId);
    if (ghostTs == 0) return;
    (, uint32 storedTs) = feed.read_beacon(beaconId);
    assertEq(uint256(storedTs), ghostTs);
  }

  function _checkTimestampBound(bytes32 beaconId) internal view {
    uint256 ghostTs = handler.ghost_latestTimestamp(beaconId);
    if (ghostTs == 0) return;
    (, uint32 storedTs) = feed.read_beacon(beaconId);
    assertLt(uint256(storedTs), block.timestamp + 300);
  }
}
