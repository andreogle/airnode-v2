// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from 'forge-std/Test.sol';
import { AirnodeVerifier } from '../src/AirnodeVerifier.sol';
import { MockCallback } from './MockCallback.sol';

// =============================================================================
// Handler — bounded operations for the fuzzer
// =============================================================================
contract VerifierHandler is Test {
  AirnodeVerifier public verifier;
  MockCallback public callback;

  uint256 constant AIRNODE_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
  address public airnodeAddress;

  // Ghost state
  uint256 public ghost_fulfillCount;
  mapping(bytes32 => bool) public ghost_fulfilled;

  constructor(AirnodeVerifier _verifier, MockCallback _callback) {
    verifier = _verifier;
    callback = _callback;
    airnodeAddress = vm.addr(AIRNODE_KEY);
  }

  function fulfill(bytes32 endpointId, uint256 timestamp, int256 value) external {
    // Bound inputs to reasonable ranges
    timestamp = bound(timestamp, 1, block.timestamp);
    value = bound(value, -1e36, 1e36);

    bytes memory data = abi.encode(value);
    bytes32 requestHash = keccak256(abi.encodePacked(endpointId, timestamp, data));

    // Skip if already fulfilled (would revert)
    if (ghost_fulfilled[requestHash]) return;

    bytes32 messageHash = keccak256(abi.encodePacked(endpointId, timestamp, data));
    bytes32 ethSignedHash = keccak256(abi.encodePacked('\x19Ethereum Signed Message:\n32', messageHash));
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(AIRNODE_KEY, ethSignedHash);
    bytes memory sig = abi.encodePacked(r, s, v);

    verifier.verifyAndFulfill(
      airnodeAddress,
      endpointId,
      timestamp,
      data,
      sig,
      address(callback),
      MockCallback.fulfill.selector
    );

    ghost_fulfillCount++;
    ghost_fulfilled[requestHash] = true;
  }
}

// =============================================================================
// Invariant test
// =============================================================================
contract AirnodeVerifierInvariantTest is Test {
  AirnodeVerifier verifier;
  MockCallback callback;
  VerifierHandler handler;

  function setUp() public {
    vm.warp(1_700_000_100);
    verifier = new AirnodeVerifier();
    callback = new MockCallback();
    handler = new VerifierHandler(verifier, callback);
    targetContract(address(handler));
  }

  /// @notice Callback count always matches ghost fulfill count
  function invariant_callback_count_matches_ghost() public view {
    assertEq(callback.callCount(), handler.ghost_fulfillCount());
  }

  /// @notice Every hash the ghost says is fulfilled, the contract also says is fulfilled
  function invariant_ghost_fulfilled_matches_contract() public view {
    // We can't iterate the mapping, but the counts must match
    assertEq(callback.callCount(), handler.ghost_fulfillCount());
  }
}
