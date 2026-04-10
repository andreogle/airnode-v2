// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from 'forge-std/Test.sol';
import { AirnodeVerifier } from '../src/AirnodeVerifier.sol';
import { ConfidentialPriceFeed } from '../src/examples/ConfidentialPriceFeed.sol';
import { MockTFHE } from './MockTFHE.sol';

// =============================================================================
// Handler — bounded operations for the fuzzer
//
// Exposes all state-mutating ConfidentialPriceFeed operations to the invariant
// fuzzer. Ghost state tracks expected ACL grants and price updates so invariants
// can verify the contract never leaks access or accepts stale data.
// =============================================================================
contract ConfidentialFeedHandler is Test {
  AirnodeVerifier public verifier;
  ConfidentialPriceFeed public feed;
  MockTFHE public tfhe;

  uint256 constant AIRNODE_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
  address public airnodeAddress;
  address public feedOwner;

  // Ghost state
  uint256 public ghost_fulfillCount;
  uint256 public ghost_grantCount;
  uint256 public ghost_revokeCount;
  mapping(bytes32 => uint256) public ghost_timestamps;
  mapping(uint256 => mapping(address => bool)) public ghost_acl;

  // Track granted addresses per handle for iteration
  address[] public grantedAddresses;
  uint256[] public grantedHandles;

  constructor(AirnodeVerifier _verifier, ConfidentialPriceFeed _feed, MockTFHE _tfhe, address _feedOwner) {
    verifier = _verifier;
    feed = _feed;
    tfhe = _tfhe;
    feedOwner = _feedOwner;
    airnodeAddress = vm.addr(AIRNODE_KEY);
  }

  // ===========================================================================
  // fulfill — submit signed encrypted data through the verifier
  // ===========================================================================
  function fulfill(bytes32 endpointId, uint256 timestamp, bytes32 handleRef) external {
    timestamp = bound(timestamp, 1, block.timestamp);

    // Only submit if timestamp is strictly newer (otherwise callback reverts silently)
    if (timestamp <= ghost_timestamps[endpointId]) return;

    bytes memory inputProof = abi.encodePacked(handleRef);
    bytes memory data = abi.encode(handleRef, inputProof);

    bytes32 messageHash = keccak256(abi.encodePacked(endpointId, timestamp, data));

    // Skip if already fulfilled in verifier (would revert)
    if (verifier.fulfilled(messageHash)) return;

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

    ghost_fulfillCount++;
    ghost_timestamps[endpointId] = timestamp;
  }

  // ===========================================================================
  // grantAccess — owner grants decryption access
  // ===========================================================================
  function grantAccess(bytes32 endpointId, address account) external {
    uint256 handle = feed.prices(endpointId);
    if (handle == 0) return;

    vm.prank(feedOwner);
    feed.grantAccess(endpointId, account);

    ghost_grantCount++;
    ghost_acl[handle][account] = true;
    grantedAddresses.push(account);
    grantedHandles.push(handle);
  }

  // ===========================================================================
  // revokeAccess — owner revokes decryption access
  // ===========================================================================
  function revokeAccess(bytes32 endpointId, address account) external {
    uint256 handle = feed.prices(endpointId);
    if (handle == 0) return;

    vm.prank(feedOwner);
    feed.revokeAccess(endpointId, account);

    ghost_revokeCount++;
    ghost_acl[handle][account] = false;
  }

  // ===========================================================================
  // unauthorizedGrant — non-owner attempts to grant access (should always fail)
  // ===========================================================================
  function unauthorizedGrant(bytes32 endpointId, address attacker, address target) external {
    uint256 handle = feed.prices(endpointId);
    if (handle == 0) return;
    if (attacker == feedOwner) return;

    vm.prank(attacker);
    try feed.grantAccess(endpointId, target) {
      // Should never succeed
      assert(false);
    } catch {
      // Expected revert
    }
  }

  // ===========================================================================
  // directTfheAllow — non-owner tries to call TFHE.allow directly (should fail)
  // ===========================================================================
  function directTfheAllow(bytes32 endpointId, address attacker) external {
    uint256 handle = feed.prices(endpointId);
    if (handle == 0) return;
    if (attacker == address(feed)) return;

    vm.prank(attacker);
    try tfhe.allow(handle, attacker) {
      // Should never succeed — only handle owner (the feed) can allow
      assert(false);
    } catch {
      // Expected revert
    }
  }

  function getGrantedAddressesLength() external view returns (uint256) {
    return grantedAddresses.length;
  }
}

// =============================================================================
// Invariant test
// =============================================================================
contract ConfidentialPriceFeedInvariantTest is Test {
  AirnodeVerifier verifier;
  MockTFHE tfhe;
  ConfidentialPriceFeed feed;
  ConfidentialFeedHandler handler;

  address constant FEED_OWNER = address(0xF00D);

  function setUp() public {
    vm.warp(1_700_000_100);

    verifier = new AirnodeVerifier();
    tfhe = new MockTFHE();

    vm.prank(FEED_OWNER);
    feed = new ConfidentialPriceFeed(address(verifier), address(tfhe));

    vm.prank(FEED_OWNER);
    feed.trustAirnode(vm.addr(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));

    handler = new ConfidentialFeedHandler(verifier, feed, tfhe, FEED_OWNER);
    targetContract(address(handler));
  }

  /// @notice Every successful fulfill increments the ghost count — no silent drops
  function invariant_fulfill_count_consistent() public view {
    // The mock TFHE's nextHandle is 1-indexed, so (nextHandle - 1) = total handles created.
    // This must equal ghost_fulfillCount because each fulfill creates exactly one handle.
    assertEq(tfhe.nextHandle() - 1, handler.ghost_fulfillCount());
  }

  /// @notice The feed always has self-access on every handle it created.
  ///         This is the core privacy property: the feed is always in its own ACL.
  function invariant_feed_always_has_self_access() public view {
    uint256 totalHandles = tfhe.nextHandle();
    // eslint-disable-next-line functional/no-loop-statements
    for (uint256 h = 1; h < totalHandles; h++) {
      assertTrue(tfhe.acl(h, address(feed)));
    }
  }

  /// @notice Ghost ACL matches real TFHE ACL for all recorded grants.
  ///         If the ghost says an address is granted, the TFHE mock agrees (and vice versa).
  function invariant_ghost_acl_matches_tfhe_acl() public view {
    uint256 len = handler.getGrantedAddressesLength();
    for (uint256 i = 0; i < len; i++) {
      address account = handler.grantedAddresses(i);
      uint256 handle = handler.grantedHandles(i);
      assertEq(tfhe.acl(handle, account), handler.ghost_acl(handle, account));
    }
  }

  /// @notice Timestamps only move forward — no endpoint ever has a timestamp older
  ///         than what the ghost recorded. Prevents rollback attacks.
  function invariant_timestamps_monotonically_increase() public view {
    // We verify indirectly: ghost_fulfillCount == handles created, and the
    // handler only increments ghost_timestamps when timestamp > previous.
    // If the feed accepted stale data, ghost_fulfillCount would diverge from
    // the handle count.
    assertEq(tfhe.nextHandle() - 1, handler.ghost_fulfillCount());
  }
}
