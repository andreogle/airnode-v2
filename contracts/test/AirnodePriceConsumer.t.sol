// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from 'forge-std/Test.sol';
import { AirnodeVerifier } from '../src/AirnodeVerifier.sol';
import { AirnodePriceConsumer } from '../src/examples/AirnodePriceConsumer.sol';

contract AirnodePriceConsumerTest is Test {
  AirnodeVerifier verifier;
  AirnodePriceConsumer consumer;

  uint256 constant AIRNODE_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
  address airnode;

  bytes32 constant ENDPOINT_ID = bytes32(uint256(0x42));
  uint256 constant MAX_STALENESS = 1 hours;
  uint256 constant TIMESTAMP = 1_700_000_000;
  bytes4 constant SELECTOR = AirnodePriceConsumer.fulfill.selector;

  function setUp() public {
    verifier = new AirnodeVerifier();
    airnode = vm.addr(AIRNODE_KEY);
    consumer = new AirnodePriceConsumer(address(verifier), airnode, ENDPOINT_ID, MAX_STALENESS);
    vm.warp(TIMESTAMP + 60); // a minute after the data timestamp
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

  function _submit(bytes32 endpointId, uint256 timestamp, bytes memory data) internal {
    bytes memory sig = _sign(endpointId, timestamp, data);
    verifier.verifyAndFulfill(airnode, endpointId, timestamp, data, sig, address(consumer), SELECTOR);
  }

  // ===========================================================================
  // Constructor
  // ===========================================================================

  function test_constructor_rejects_zero_verifier() public {
    vm.expectRevert(AirnodePriceConsumer.ZeroAddress.selector);
    new AirnodePriceConsumer(address(0), airnode, ENDPOINT_ID, MAX_STALENESS);
  }

  function test_constructor_rejects_zero_airnode() public {
    vm.expectRevert(AirnodePriceConsumer.ZeroAddress.selector);
    new AirnodePriceConsumer(address(verifier), address(0), ENDPOINT_ID, MAX_STALENESS);
  }

  // ===========================================================================
  // Happy path (end-to-end via AirnodeVerifier)
  // ===========================================================================

  function test_accepts_a_valid_signed_payload() public {
    _submit(ENDPOINT_ID, TIMESTAMP, abi.encode(int256(3000e18)));

    assertEq(consumer.latestPrice(), int256(3000e18));
    assertEq(consumer.latestTimestamp(), TIMESTAMP);
  }

  function testFuzz_stores_any_int256(int256 value) public {
    _submit(ENDPOINT_ID, TIMESTAMP, abi.encode(value));
    assertEq(consumer.latestPrice(), value);
    assertEq(consumer.latestTimestamp(), TIMESTAMP);
  }

  // ===========================================================================
  // The four required checks (driven directly, as AirnodeVerifier would call)
  // ===========================================================================

  function test_rejects_a_caller_that_is_not_the_verifier() public {
    // A signature is never checked by the consumer — only AirnodeVerifier does that —
    // so a direct call must be refused or anyone could set the price.
    vm.expectRevert(abi.encodeWithSelector(AirnodePriceConsumer.NotVerifier.selector, address(this)));
    consumer.fulfill(bytes32(0), airnode, ENDPOINT_ID, TIMESTAMP, abi.encode(int256(1)));
  }

  function test_rejects_an_untrusted_airnode() public {
    address impostor = address(0xBAD);
    vm.prank(address(verifier));
    vm.expectRevert(abi.encodeWithSelector(AirnodePriceConsumer.UntrustedAirnode.selector, impostor));
    consumer.fulfill(bytes32(0), impostor, ENDPOINT_ID, TIMESTAMP, abi.encode(int256(1)));
  }

  function test_rejects_data_from_the_wrong_endpoint() public {
    bytes32 otherEndpoint = bytes32(uint256(0x99));
    vm.prank(address(verifier));
    vm.expectRevert(abi.encodeWithSelector(AirnodePriceConsumer.WrongEndpoint.selector, otherEndpoint));
    consumer.fulfill(bytes32(0), airnode, otherEndpoint, TIMESTAMP, abi.encode(int256(1)));
  }

  function test_rejects_a_future_timestamp() public {
    uint256 future = block.timestamp + 1;
    vm.prank(address(verifier));
    vm.expectRevert(abi.encodeWithSelector(AirnodePriceConsumer.TimestampInFuture.selector, future));
    consumer.fulfill(bytes32(0), airnode, ENDPOINT_ID, future, abi.encode(int256(1)));
  }

  function test_rejects_stale_data() public {
    vm.warp(TIMESTAMP + MAX_STALENESS + 1);
    vm.prank(address(verifier));
    vm.expectRevert(
      abi.encodeWithSelector(AirnodePriceConsumer.DataTooStale.selector, TIMESTAMP, TIMESTAMP + MAX_STALENESS)
    );
    consumer.fulfill(bytes32(0), airnode, ENDPOINT_ID, TIMESTAMP, abi.encode(int256(1)));
  }

  function test_accepts_data_at_the_staleness_boundary() public {
    vm.warp(TIMESTAMP + MAX_STALENESS); // exactly at the deadline — still OK
    _submit(ENDPOINT_ID, TIMESTAMP, abi.encode(int256(42)));
    assertEq(consumer.latestPrice(), int256(42));
  }

  // ===========================================================================
  // Out-of-order delivery — accepted but ignored, no revert
  // ===========================================================================

  function test_ignores_an_out_of_order_update() public {
    _submit(ENDPOINT_ID, TIMESTAMP, abi.encode(int256(3000e18)));
    assertEq(consumer.latestTimestamp(), TIMESTAMP);

    // An older payload arrives afterwards: the call succeeds but state is unchanged.
    vm.prank(address(verifier));
    consumer.fulfill(bytes32(0), airnode, ENDPOINT_ID, TIMESTAMP - 60, abi.encode(int256(1e18)));

    assertEq(consumer.latestPrice(), int256(3000e18));
    assertEq(consumer.latestTimestamp(), TIMESTAMP);
  }

  // A consumer revert inside the callback does not revert verifyAndFulfill — the request
  // is still marked fulfilled (anti-griefing). The consumer's state simply stays put.
  function test_consumer_revert_does_not_break_verifyAndFulfill() public {
    bytes memory data = abi.encode(int256(7));
    bytes32 wrongEndpoint = bytes32(uint256(0xDEAD));
    bytes memory sig = _sign(wrongEndpoint, TIMESTAMP, data);

    verifier.verifyAndFulfill(airnode, wrongEndpoint, TIMESTAMP, data, sig, address(consumer), SELECTOR);

    assertTrue(verifier.fulfilled(keccak256(abi.encodePacked(wrongEndpoint, TIMESTAMP, data))));
    assertEq(consumer.latestTimestamp(), 0); // consumer rejected it (WrongEndpoint)
  }
}
