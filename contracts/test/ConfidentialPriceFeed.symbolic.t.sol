// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from 'forge-std/Test.sol';
import { AirnodeVerifier } from '../src/AirnodeVerifier.sol';
import { ConfidentialPriceFeed } from '../src/examples/ConfidentialPriceFeed.sol';
import { MockTFHE } from './MockTFHE.sol';

/// @notice Symbolic tests for ConfidentialPriceFeed. Run with Halmos.
///         These prove privacy-critical properties hold for ALL possible inputs.
contract ConfidentialPriceFeedSymbolicTest is Test {
  AirnodeVerifier verifier;
  MockTFHE tfhe;
  ConfidentialPriceFeed feed;

  uint256 constant AIRNODE_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
  address airnodeAddress;
  address constant FEED_OWNER = address(0xF00D);

  function setUp() public {
    verifier = new AirnodeVerifier();
    tfhe = new MockTFHE();

    vm.prank(FEED_OWNER);
    feed = new ConfidentialPriceFeed(address(verifier), address(tfhe));

    airnodeAddress = vm.addr(AIRNODE_KEY);

    vm.prank(FEED_OWNER);
    feed.trustAirnode(airnodeAddress);

    vm.warp(1_700_000_100);
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  function _fulfillViaVerifier(bytes32 endpointId, uint256 timestamp, bytes memory data) internal {
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
      address(feed),
      ConfidentialPriceFeed.fulfill.selector
    );
  }

  // ===========================================================================
  // Privacy property: feed always grants itself access on every handle
  // ===========================================================================

  /// @notice After any successful fulfill, the feed contract has access to the
  ///         resulting handle. This ensures the contract can always operate on
  ///         its own encrypted data.
  function check_feed_has_self_access_after_fulfill(bytes32 endpointId, uint256 timestamp) public {
    vm.assume(timestamp > 0 && timestamp <= block.timestamp);

    bytes32 handleRef = bytes32(uint256(0xabc));
    bytes memory inputProof = hex'1234';
    bytes memory data = abi.encode(handleRef, inputProof);

    bytes32 requestHash = keccak256(abi.encodePacked(endpointId, timestamp, data));
    vm.assume(!verifier.fulfilled(requestHash));

    _fulfillViaVerifier(endpointId, timestamp, data);

    uint256 handle = feed.prices(endpointId);
    assert(handle != 0);
    assert(tfhe.acl(handle, address(feed)));
  }

  // ===========================================================================
  // Privacy property: non-owner can never grant access
  // ===========================================================================

  /// @notice For any address that is not the owner, grantAccess always reverts.
  ///         This proves no path exists for unauthorized access grants.
  function check_non_owner_cannot_grant(
    bytes32 endpointId,
    uint256 timestamp,
    address attacker,
    address target
  ) public {
    vm.assume(timestamp > 0 && timestamp <= block.timestamp);
    vm.assume(attacker != FEED_OWNER);

    bytes32 handleRef = bytes32(uint256(0xdef));
    bytes memory inputProof = hex'5678';
    bytes memory data = abi.encode(handleRef, inputProof);

    bytes32 requestHash = keccak256(abi.encodePacked(endpointId, timestamp, data));
    vm.assume(!verifier.fulfilled(requestHash));

    _fulfillViaVerifier(endpointId, timestamp, data);

    vm.prank(attacker);
    try feed.grantAccess(endpointId, target) {
      assert(false); // Must never succeed
    } catch {
      assert(true);
    }
  }

  // ===========================================================================
  // Privacy property: non-owner can never revoke access
  // ===========================================================================

  /// @notice For any address that is not the owner, revokeAccess always reverts.
  function check_non_owner_cannot_revoke(
    bytes32 endpointId,
    uint256 timestamp,
    address attacker,
    address target
  ) public {
    vm.assume(timestamp > 0 && timestamp <= block.timestamp);
    vm.assume(attacker != FEED_OWNER);

    bytes32 handleRef = bytes32(uint256(0x123));
    bytes memory inputProof = hex'abcd';
    bytes memory data = abi.encode(handleRef, inputProof);

    bytes32 requestHash = keccak256(abi.encodePacked(endpointId, timestamp, data));
    vm.assume(!verifier.fulfilled(requestHash));

    _fulfillViaVerifier(endpointId, timestamp, data);

    // Owner grants first
    vm.prank(FEED_OWNER);
    feed.grantAccess(endpointId, target);

    // Attacker tries to revoke
    vm.prank(attacker);
    try feed.revokeAccess(endpointId, target) {
      assert(false); // Must never succeed
    } catch {
      assert(true);
    }
  }

  // ===========================================================================
  // Privacy property: external contracts cannot manipulate handle ACL
  // ===========================================================================

  /// @notice No address other than the feed can call TFHE.allow on the feed's handles.
  ///         This proves the FHE coprocessor's ownership model prevents external ACL tampering.
  function check_external_cannot_allow_on_handle(bytes32 endpointId, uint256 timestamp, address attacker) public {
    vm.assume(timestamp > 0 && timestamp <= block.timestamp);
    vm.assume(attacker != address(feed));

    bytes32 handleRef = bytes32(uint256(0x456));
    bytes memory inputProof = hex'ef01';
    bytes memory data = abi.encode(handleRef, inputProof);

    bytes32 requestHash = keccak256(abi.encodePacked(endpointId, timestamp, data));
    vm.assume(!verifier.fulfilled(requestHash));

    _fulfillViaVerifier(endpointId, timestamp, data);

    uint256 handle = feed.prices(endpointId);

    vm.prank(attacker);
    try tfhe.allow(handle, attacker) {
      assert(false); // Must never succeed
    } catch {
      assert(true);
    }
  }

  // ===========================================================================
  // Integrity property: stale data never overwrites fresh data
  // ===========================================================================

  /// @notice Once a price is set at timestamp T, submitting data at timestamp < T
  ///         never updates the price. Proves monotonic timestamp enforcement.
  function check_stale_data_rejected(bytes32 endpointId, uint256 freshTs, uint256 staleTs) public {
    vm.assume(freshTs > 0 && freshTs <= block.timestamp);
    vm.assume(staleTs > 0 && staleTs < freshTs);

    // Submit fresh data
    bytes32 freshRef = bytes32(uint256(0xfeed));
    bytes memory freshData = abi.encode(freshRef, hex'aa');
    bytes32 freshHash = keccak256(abi.encodePacked(endpointId, freshTs, freshData));
    vm.assume(!verifier.fulfilled(freshHash));

    _fulfillViaVerifier(endpointId, freshTs, freshData);

    uint256 freshHandle = feed.prices(endpointId);
    assert(freshHandle != 0);

    // Submit stale data — callback should revert silently
    bytes32 staleRef = bytes32(uint256(0xdead));
    bytes memory staleData = abi.encode(staleRef, hex'bb');
    bytes32 staleHash = keccak256(abi.encodePacked(endpointId, staleTs, staleData));
    vm.assume(!verifier.fulfilled(staleHash));

    _fulfillViaVerifier(endpointId, staleTs, staleData);

    // Price must not have changed
    assert(feed.prices(endpointId) == freshHandle);
    assert(feed.timestamps(endpointId) == freshTs);
  }

  // ===========================================================================
  // Integrity property: untrusted airnode data is always rejected
  // ===========================================================================

  /// @notice Data signed by an untrusted airnode never updates the price feed,
  ///         regardless of the endpoint or timestamp.
  function check_untrusted_airnode_rejected(bytes32 endpointId, uint256 timestamp, uint256 untrustedKey) public {
    vm.assume(timestamp > 0 && timestamp <= block.timestamp);
    vm.assume(untrustedKey != 0 && untrustedKey != AIRNODE_KEY);
    // Ensure the key is valid for secp256k1
    vm.assume(untrustedKey < 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141);

    address untrustedAirnode = vm.addr(untrustedKey);
    vm.assume(untrustedAirnode != airnodeAddress);

    bytes32 handleRef = bytes32(uint256(0xbad));
    bytes memory data = abi.encode(handleRef, hex'cc');

    bytes32 messageHash = keccak256(abi.encodePacked(endpointId, timestamp, data));
    bytes32 ethSignedHash = keccak256(abi.encodePacked('\x19Ethereum Signed Message:\n32', messageHash));
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(untrustedKey, ethSignedHash);
    bytes memory sig = abi.encodePacked(r, s, v);

    bytes32 requestHash = keccak256(abi.encodePacked(endpointId, timestamp, data));
    vm.assume(!verifier.fulfilled(requestHash));

    // This will revert at the verifier level ("Signature mismatch") since we
    // pass airnodeAddress but signed with a different key. If we passed
    // untrustedAirnode, the verifier would succeed but the feed would reject
    // (untrusted airnode). Either way, price must not update.

    // Try with the correct untrusted airnode address — verifier passes, feed rejects
    verifier.verifyAndFulfill(
      untrustedAirnode,
      endpointId,
      timestamp,
      data,
      sig,
      address(feed),
      ConfidentialPriceFeed.fulfill.selector
    );

    // Price must not have been set
    assert(feed.prices(endpointId) == 0);
  }
}
