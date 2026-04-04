// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from 'forge-std/Test.sol';
import { AirnodeVerifier } from '../src/AirnodeVerifier.sol';
import { MockCallback } from './MockCallback.sol';

/// @notice Symbolic tests for AirnodeVerifier. Run with Halmos.
///         These prove properties hold for ALL possible inputs, not just random samples.
contract AirnodeVerifierSymbolicTest is Test {
  AirnodeVerifier verifier;
  MockCallback callback;

  uint256 constant AIRNODE_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
  address airnodeAddress;

  function setUp() public {
    verifier = new AirnodeVerifier();
    callback = new MockCallback();
    airnodeAddress = vm.addr(AIRNODE_KEY);
    vm.warp(1_700_000_100);
  }

  /// @notice After fulfillment, the fulfilled flag is always true for the request hash
  function check_fulfilled_flag_set_after_fulfill(bytes32 endpointId, uint256 timestamp) public {
    // Bound timestamp to valid range
    vm.assume(timestamp > 0 && timestamp <= block.timestamp);

    bytes memory data = abi.encode(int256(1000e18));
    bytes32 requestHash = keccak256(abi.encodePacked(endpointId, timestamp, data));

    // Pre-condition: not already fulfilled
    vm.assume(!verifier.fulfilled(requestHash));

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

    assert(verifier.fulfilled(requestHash));
  }

  /// @notice Replay always reverts — for any hash, fulfilling twice fails
  function check_replay_always_reverts(bytes32 endpointId, uint256 timestamp) public {
    vm.assume(timestamp > 0 && timestamp <= block.timestamp);

    bytes memory data = abi.encode(int256(2000e18));

    bytes32 messageHash = keccak256(abi.encodePacked(endpointId, timestamp, data));
    bytes32 ethSignedHash = keccak256(abi.encodePacked('\x19Ethereum Signed Message:\n32', messageHash));
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(AIRNODE_KEY, ethSignedHash);
    bytes memory sig = abi.encodePacked(r, s, v);

    bytes32 requestHash = keccak256(abi.encodePacked(endpointId, timestamp, data));
    vm.assume(!verifier.fulfilled(requestHash));

    // First call succeeds
    verifier.verifyAndFulfill(
      airnodeAddress,
      endpointId,
      timestamp,
      data,
      sig,
      address(callback),
      MockCallback.fulfill.selector
    );

    // Second call must revert
    try
      verifier.verifyAndFulfill(
        airnodeAddress,
        endpointId,
        timestamp,
        data,
        sig,
        address(callback),
        MockCallback.fulfill.selector
      )
    {
      assert(false); // Should not reach here
    } catch {
      assert(true); // Expected revert
    }
  }
}
