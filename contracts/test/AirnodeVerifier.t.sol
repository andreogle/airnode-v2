// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from 'forge-std/Test.sol';
import { AirnodeVerifier } from '../src/AirnodeVerifier.sol';
import { MockCallback, RevertingCallback } from './MockCallback.sol';

contract AirnodeVerifierTest is Test {
  AirnodeVerifier verifier;
  MockCallback callback;
  RevertingCallback revertingCallback;

  uint256 constant AIRNODE_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
  address airnodeAddress;

  bytes32 constant ENDPOINT_ID = bytes32(uint256(1));
  uint256 constant TIMESTAMP = 1_700_000_000;
  bytes constant DATA = abi.encode(int256(3000e18));
  bytes4 constant CALLBACK_SELECTOR = MockCallback.fulfill.selector;

  function setUp() public {
    verifier = new AirnodeVerifier();
    callback = new MockCallback();
    revertingCallback = new RevertingCallback();
    airnodeAddress = vm.addr(AIRNODE_KEY);

    // Warp to a time after TIMESTAMP so the timestamp is in the past
    vm.warp(TIMESTAMP + 100);
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  function _sign(bytes32 endpointId, uint256 timestamp, bytes memory data) internal pure returns (bytes memory) {
    bytes32 messageHash = keccak256(abi.encodePacked(endpointId, timestamp, data));
    bytes32 ethSignedHash = keccak256(abi.encodePacked('\x19Ethereum Signed Message:\n32', messageHash));
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(AIRNODE_KEY, ethSignedHash);
    return abi.encodePacked(r, s, v);
  }

  // ===========================================================================
  // verifyAndFulfill
  // ===========================================================================

  function test_fulfills_with_valid_signature() public {
    bytes memory sig = _sign(ENDPOINT_ID, TIMESTAMP, DATA);

    verifier.verifyAndFulfill(airnodeAddress, ENDPOINT_ID, TIMESTAMP, DATA, sig, address(callback), CALLBACK_SELECTOR);

    assertEq(callback.callCount(), 1);
    assertEq(callback.lastAirnode(), airnodeAddress);
    assertEq(callback.lastEndpointId(), ENDPOINT_ID);
    assertEq(callback.lastTimestamp(), TIMESTAMP);
    assertEq(callback.lastData(), DATA);
  }

  function test_sets_fulfilled_flag() public {
    bytes memory sig = _sign(ENDPOINT_ID, TIMESTAMP, DATA);
    bytes32 requestHash = keccak256(abi.encodePacked(ENDPOINT_ID, TIMESTAMP, DATA));

    assertFalse(verifier.fulfilled(requestHash));

    verifier.verifyAndFulfill(airnodeAddress, ENDPOINT_ID, TIMESTAMP, DATA, sig, address(callback), CALLBACK_SELECTOR);

    assertTrue(verifier.fulfilled(requestHash));
  }

  function test_reverts_on_replay() public {
    bytes memory sig = _sign(ENDPOINT_ID, TIMESTAMP, DATA);

    verifier.verifyAndFulfill(airnodeAddress, ENDPOINT_ID, TIMESTAMP, DATA, sig, address(callback), CALLBACK_SELECTOR);

    vm.expectRevert('Already fulfilled');
    verifier.verifyAndFulfill(airnodeAddress, ENDPOINT_ID, TIMESTAMP, DATA, sig, address(callback), CALLBACK_SELECTOR);
  }

  function test_reverts_on_wrong_airnode() public {
    bytes memory sig = _sign(ENDPOINT_ID, TIMESTAMP, DATA);
    address wrongAirnode = address(0xdead);

    vm.expectRevert('Signature mismatch');
    verifier.verifyAndFulfill(wrongAirnode, ENDPOINT_ID, TIMESTAMP, DATA, sig, address(callback), CALLBACK_SELECTOR);
  }

  function test_reverts_on_tampered_data() public {
    bytes memory sig = _sign(ENDPOINT_ID, TIMESTAMP, DATA);
    bytes memory tamperedData = abi.encode(int256(9999e18));

    vm.expectRevert('Signature mismatch');
    verifier.verifyAndFulfill(
      airnodeAddress,
      ENDPOINT_ID,
      TIMESTAMP,
      tamperedData,
      sig,
      address(callback),
      CALLBACK_SELECTOR
    );
  }

  function test_fulfills_even_when_callback_reverts() public {
    bytes memory sig = _sign(ENDPOINT_ID, TIMESTAMP, DATA);
    bytes32 requestHash = keccak256(abi.encodePacked(ENDPOINT_ID, TIMESTAMP, DATA));

    // Should not revert — the callback reverts but the fulfillment is recorded
    verifier.verifyAndFulfill(
      airnodeAddress,
      ENDPOINT_ID,
      TIMESTAMP,
      DATA,
      sig,
      address(revertingCallback),
      RevertingCallback.fulfill.selector
    );

    assertTrue(verifier.fulfilled(requestHash));
  }

  function test_different_data_produces_different_request_hash() public {
    bytes memory data1 = abi.encode(int256(1000e18));
    bytes memory data2 = abi.encode(int256(2000e18));
    bytes memory sig1 = _sign(ENDPOINT_ID, TIMESTAMP, data1);
    bytes memory sig2 = _sign(ENDPOINT_ID, TIMESTAMP, data2);

    verifier.verifyAndFulfill(
      airnodeAddress,
      ENDPOINT_ID,
      TIMESTAMP,
      data1,
      sig1,
      address(callback),
      CALLBACK_SELECTOR
    );

    // Same endpoint + timestamp but different data — should succeed (not replay)
    verifier.verifyAndFulfill(
      airnodeAddress,
      ENDPOINT_ID,
      TIMESTAMP,
      data2,
      sig2,
      address(callback),
      CALLBACK_SELECTOR
    );

    assertEq(callback.callCount(), 2);
  }

  function test_reverts_on_zero_callback_address() public {
    bytes memory sig = _sign(ENDPOINT_ID, TIMESTAMP, DATA);

    vm.expectRevert('Callback address is zero');
    verifier.verifyAndFulfill(airnodeAddress, ENDPOINT_ID, TIMESTAMP, DATA, sig, address(0), CALLBACK_SELECTOR);
  }

  function test_different_timestamps_produce_different_request_hash() public {
    bytes memory sig1 = _sign(ENDPOINT_ID, TIMESTAMP, DATA);
    bytes memory sig2 = _sign(ENDPOINT_ID, TIMESTAMP + 1, DATA);

    verifier.verifyAndFulfill(airnodeAddress, ENDPOINT_ID, TIMESTAMP, DATA, sig1, address(callback), CALLBACK_SELECTOR);

    verifier.verifyAndFulfill(
      airnodeAddress,
      ENDPOINT_ID,
      TIMESTAMP + 1,
      DATA,
      sig2,
      address(callback),
      CALLBACK_SELECTOR
    );

    assertEq(callback.callCount(), 2);
  }
}
