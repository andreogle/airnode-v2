// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from 'forge-std/Test.sol';
import { AirnodeVerifier } from '../src/AirnodeVerifier.sol';
import { ConfidentialPriceFeed } from '../src/examples/ConfidentialPriceFeed.sol';
import { MockTFHE } from './MockTFHE.sol';

contract ConfidentialPriceFeedTest is Test {
  AirnodeVerifier verifier;
  MockTFHE tfhe;
  ConfidentialPriceFeed feed;

  uint256 constant AIRNODE_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
  address airnodeAddress;
  address owner = address(this);
  address consumer = address(0xC0DE);

  bytes32 constant ENDPOINT_ID = bytes32(uint256(1));
  uint256 constant TIMESTAMP = 1_700_000_000;

  // Simulated FHE payload: abi.encode(handleRef, inputProof)
  bytes32 constant HANDLE_REF = bytes32(uint256(0xf0e));
  bytes constant INPUT_PROOF = hex'deadbeef';
  bytes DATA = abi.encode(HANDLE_REF, INPUT_PROOF);

  bytes4 constant CALLBACK_SELECTOR = ConfidentialPriceFeed.fulfill.selector;

  function setUp() public {
    verifier = new AirnodeVerifier();
    tfhe = new MockTFHE();
    feed = new ConfidentialPriceFeed(address(verifier), address(tfhe));
    airnodeAddress = vm.addr(AIRNODE_KEY);

    // Trust the airnode
    feed.trustAirnode(airnodeAddress);

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

  function _fulfill(bytes32 endpointId, uint256 timestamp, bytes memory data) internal {
    bytes memory sig = _sign(endpointId, timestamp, data);
    verifier.verifyAndFulfill(airnodeAddress, endpointId, timestamp, data, sig, address(feed), CALLBACK_SELECTOR);
  }

  // ===========================================================================
  // fulfill
  // ===========================================================================

  function test_registers_fhe_handle_on_fulfill() public {
    _fulfill(ENDPOINT_ID, TIMESTAMP, DATA);

    // The mock TFHE should have received our handle ref and proof
    assertEq(tfhe.lastHandleRef(), HANDLE_REF);
    assertEq(tfhe.lastInputProof(), INPUT_PROOF);

    // Price handle should be stored (mock returns sequential IDs starting at 1)
    assertEq(feed.prices(ENDPOINT_ID), 1);
    assertEq(feed.timestamps(ENDPOINT_ID), TIMESTAMP);
  }

  function test_grants_self_access_on_fulfill() public {
    _fulfill(ENDPOINT_ID, TIMESTAMP, DATA);

    uint256 handle = feed.prices(ENDPOINT_ID);
    assertTrue(tfhe.acl(handle, address(feed)));
  }

  function test_rejects_untrusted_airnode() public {
    feed.removeAirnode(airnodeAddress);

    bytes memory sig = _sign(ENDPOINT_ID, TIMESTAMP, DATA);

    // The verifier will call fulfill, but fulfill will silently fail (low-level call)
    // because the airnode is untrusted. The verifier still records fulfillment.
    verifier.verifyAndFulfill(airnodeAddress, ENDPOINT_ID, TIMESTAMP, DATA, sig, address(feed), CALLBACK_SELECTOR);

    // Price should NOT be stored since the callback reverted
    assertEq(feed.prices(ENDPOINT_ID), 0);
  }

  function test_rejects_stale_data() public {
    _fulfill(ENDPOINT_ID, TIMESTAMP, DATA);

    // Try to submit older data — the callback should revert (silently via verifier)
    bytes memory olderData = abi.encode(bytes32(uint256(0x01d)), hex'cafe');
    uint256 olderTimestamp = TIMESTAMP - 1;
    bytes memory sig = _sign(ENDPOINT_ID, olderTimestamp, olderData);
    verifier.verifyAndFulfill(
      airnodeAddress,
      ENDPOINT_ID,
      olderTimestamp,
      olderData,
      sig,
      address(feed),
      CALLBACK_SELECTOR
    );

    // Price should still be the first one
    assertEq(feed.prices(ENDPOINT_ID), 1);
    assertEq(feed.timestamps(ENDPOINT_ID), TIMESTAMP);
  }

  function test_updates_price_with_newer_timestamp() public {
    _fulfill(ENDPOINT_ID, TIMESTAMP, DATA);

    bytes memory newerData = abi.encode(bytes32(uint256(0xe)), hex'cafe');
    _fulfill(ENDPOINT_ID, TIMESTAMP + 60, newerData);

    // Handle 2 (second registration)
    assertEq(feed.prices(ENDPOINT_ID), 2);
    assertEq(feed.timestamps(ENDPOINT_ID), TIMESTAMP + 60);
  }

  // ===========================================================================
  // Access control
  // ===========================================================================

  function test_owner_grants_access() public {
    _fulfill(ENDPOINT_ID, TIMESTAMP, DATA);

    feed.grantAccess(ENDPOINT_ID, consumer);

    uint256 handle = feed.prices(ENDPOINT_ID);
    assertTrue(tfhe.acl(handle, consumer));
  }

  function test_owner_revokes_access() public {
    _fulfill(ENDPOINT_ID, TIMESTAMP, DATA);

    feed.grantAccess(ENDPOINT_ID, consumer);
    feed.revokeAccess(ENDPOINT_ID, consumer);

    uint256 handle = feed.prices(ENDPOINT_ID);
    assertFalse(tfhe.acl(handle, consumer));
  }

  function test_non_owner_cannot_grant_access() public {
    _fulfill(ENDPOINT_ID, TIMESTAMP, DATA);

    vm.prank(consumer);
    vm.expectRevert('Only owner');
    feed.grantAccess(ENDPOINT_ID, consumer);
  }

  function test_non_owner_cannot_revoke_access() public {
    _fulfill(ENDPOINT_ID, TIMESTAMP, DATA);

    feed.grantAccess(ENDPOINT_ID, consumer);

    vm.prank(consumer);
    vm.expectRevert('Only owner');
    feed.revokeAccess(ENDPOINT_ID, consumer);
  }

  function test_cannot_grant_access_for_missing_endpoint() public {
    bytes32 unknownEndpoint = bytes32(uint256(999));

    vm.expectRevert('No price for endpoint');
    feed.grantAccess(unknownEndpoint, consumer);
  }

  // ===========================================================================
  // Airnode trust management
  // ===========================================================================

  function test_only_owner_can_trust_airnode() public {
    vm.prank(consumer);
    vm.expectRevert('Only owner');
    feed.trustAirnode(address(0xBEEF));
  }

  function test_only_owner_can_remove_airnode() public {
    vm.prank(consumer);
    vm.expectRevert('Only owner');
    feed.removeAirnode(airnodeAddress);
  }

  // ===========================================================================
  // Mock TFHE ACL enforcement
  // ===========================================================================

  function test_external_contract_cannot_allow_on_handle() public {
    _fulfill(ENDPOINT_ID, TIMESTAMP, DATA);

    uint256 handle = feed.prices(ENDPOINT_ID);

    // A random address trying to call allow() directly on the TFHE mock
    // should fail because they didn't create the handle
    vm.prank(consumer);
    vm.expectRevert('Not handle owner');
    tfhe.allow(handle, consumer);
  }
}
