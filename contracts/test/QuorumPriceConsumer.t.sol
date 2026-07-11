// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from 'forge-std/Test.sol';
import { AirnodeVerifier } from '../src/AirnodeVerifier.sol';
import { QuorumPriceConsumer } from '../src/examples/QuorumPriceConsumer.sol';

contract QuorumPriceConsumerTest is Test {
  AirnodeVerifier verifier;
  QuorumPriceConsumer consumer;

  uint256 constant KEY_A = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
  uint256 constant KEY_B = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
  uint256 constant KEY_C = 0x5de4111afa1c4b3daadbcb3b6c1688544a9a8d64b2d61fcdecc4f82bc4c5d5b9;
  bytes32 constant ENDPOINT_ID = bytes32(uint256(0x42));
  uint256 constant TIMESTAMP = 1_700_000_000;
  uint256 constant MAX_STALENESS = 1 hours;

  address airnodeA;
  address airnodeB;
  address airnodeC;

  function setUp() public {
    verifier = new AirnodeVerifier();
    airnodeA = vm.addr(KEY_A);
    airnodeB = vm.addr(KEY_B);
    airnodeC = vm.addr(KEY_C);

    address[] memory airnodes = new address[](3);
    airnodes[0] = airnodeA;
    airnodes[1] = airnodeB;
    airnodes[2] = airnodeC;
    consumer = new QuorumPriceConsumer(address(verifier), ENDPOINT_ID, airnodes, 2, MAX_STALENESS);
    vm.warp(TIMESTAMP + 60);
  }

  function _submit(uint256 key, uint256 timestamp, int256 value) internal {
    bytes memory data = abi.encode(value);
    bytes32 messageHash = keccak256(abi.encodePacked(ENDPOINT_ID, timestamp, data));
    bytes32 ethSignedHash = keccak256(abi.encodePacked('\x19Ethereum Signed Message:\n32', messageHash));
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, ethSignedHash);
    verifier.verifyAndFulfill(
      vm.addr(key),
      ENDPOINT_ID,
      timestamp,
      data,
      abi.encodePacked(r, s, v),
      address(consumer),
      QuorumPriceConsumer.fulfill.selector
    );
  }

  function test_requires_two_matching_airnodes() public {
    _submit(KEY_A, TIMESTAMP, 3000e18);
    assertEq(consumer.latestTimestamp(), 0);

    _submit(KEY_B, TIMESTAMP, 3000e18);
    assertEq(consumer.latestPrice(), 3000e18);
    assertEq(consumer.latestTimestamp(), TIMESTAMP);
  }

  function test_different_observations_do_not_form_a_quorum() public {
    _submit(KEY_A, TIMESTAMP, 3000e18);
    _submit(KEY_B, TIMESTAMP, 3001e18);

    assertEq(consumer.latestTimestamp(), 0);
  }

  function test_rejects_duplicate_confirmation() public {
    bytes memory data = abi.encode(int256(3000e18));
    bytes32 requestHash = keccak256(abi.encodePacked(ENDPOINT_ID, TIMESTAMP, data));

    vm.prank(address(verifier));
    consumer.fulfill(requestHash, airnodeA, ENDPOINT_ID, TIMESTAMP, data);

    vm.prank(address(verifier));
    vm.expectRevert(abi.encodeWithSelector(QuorumPriceConsumer.AlreadyConfirmed.selector, requestHash, airnodeA));
    consumer.fulfill(requestHash, airnodeA, ENDPOINT_ID, TIMESTAMP, data);
  }

  function test_rejects_mismatched_request_hash() public {
    vm.prank(address(verifier));
    vm.expectRevert(QuorumPriceConsumer.InvalidRequestHash.selector);
    consumer.fulfill(bytes32(0), airnodeA, ENDPOINT_ID, TIMESTAMP, abi.encode(int256(1)));
  }

  function test_rejects_untrusted_airnode() public {
    address untrusted = address(0xBAD);
    vm.prank(address(verifier));
    vm.expectRevert(abi.encodeWithSelector(QuorumPriceConsumer.UntrustedAirnode.selector, untrusted));
    consumer.fulfill(bytes32(0), untrusted, ENDPOINT_ID, TIMESTAMP, abi.encode(int256(1)));
  }

  function test_rejects_future_and_stale_observations() public {
    uint256 futureTimestamp = block.timestamp + 1;
    vm.prank(address(verifier));
    vm.expectRevert(abi.encodeWithSelector(QuorumPriceConsumer.TimestampInFuture.selector, futureTimestamp));
    consumer.fulfill(bytes32(0), airnodeA, ENDPOINT_ID, futureTimestamp, abi.encode(int256(1)));

    uint256 staleTimestamp = block.timestamp - MAX_STALENESS - 1;
    vm.prank(address(verifier));
    vm.expectRevert(abi.encodeWithSelector(QuorumPriceConsumer.DataTooStale.selector, staleTimestamp));
    consumer.fulfill(bytes32(0), airnodeA, ENDPOINT_ID, staleTimestamp, abi.encode(int256(1)));
  }

  function test_rejects_duplicate_airnodes_and_invalid_thresholds() public {
    address[] memory duplicates = new address[](2);
    duplicates[0] = airnodeA;
    duplicates[1] = airnodeA;
    vm.expectRevert(abi.encodeWithSelector(QuorumPriceConsumer.DuplicateAirnode.selector, airnodeA));
    new QuorumPriceConsumer(address(verifier), ENDPOINT_ID, duplicates, 2, MAX_STALENESS);

    address[] memory one = new address[](1);
    one[0] = airnodeA;
    vm.expectRevert(QuorumPriceConsumer.InvalidThreshold.selector);
    new QuorumPriceConsumer(address(verifier), ENDPOINT_ID, one, 2, MAX_STALENESS);
  }

  function test_rejects_non_intersecting_threshold() public {
    address[] memory four = new address[](4);
    four[0] = airnodeA;
    four[1] = airnodeB;
    four[2] = airnodeC;
    four[3] = address(0xD);

    vm.expectRevert(QuorumPriceConsumer.InvalidThreshold.selector);
    new QuorumPriceConsumer(address(verifier), ENDPOINT_ID, four, 2, MAX_STALENESS);
  }

  function test_rejects_verifier_without_code() public {
    address[] memory airnodes = new address[](1);
    airnodes[0] = airnodeA;

    vm.expectRevert(QuorumPriceConsumer.VerifierHasNoCode.selector);
    new QuorumPriceConsumer(address(0xBEEF), ENDPOINT_ID, airnodes, 1, MAX_STALENESS);
  }

  function test_late_third_confirmation_does_not_emit_another_update() public {
    _submit(KEY_A, TIMESTAMP, 3000e18);
    _submit(KEY_B, TIMESTAMP, 3000e18);
    _submit(KEY_C, TIMESTAMP, 3000e18);

    assertEq(consumer.latestPrice(), 3000e18);
    assertEq(consumer.latestTimestamp(), TIMESTAMP);
  }
}
