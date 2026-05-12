// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AirnodePriceConsumer
/// @notice Reference consumer for `AirnodeVerifier`. Receives a verified, Airnode-signed
///         value via `AirnodeVerifier.verifyAndFulfill(...)` and stores it — but only
///         after running the checks every consumer must do. Copy this as a starting
///         point; the four `require`s in `fulfill` are not optional.
///
/// Why these checks exist (read this before removing any of them):
///
///   `AirnodeVerifier.verifyAndFulfill` is **permissionless** — anyone can submit any
///   valid Airnode-signed payload and point the callback at any contract. Signed
///   payloads are **public** (they sit in the calldata/events of any prior submission).
///   So a consumer cannot assume *who* triggered it or *which* feed the data came from.
///   It must check:
///
///   1. `msg.sender == verifier`
///      This contract does NOT verify the signature itself — it trusts that
///      `AirnodeVerifier` already did. So it must reject calls that didn't come from
///      `AirnodeVerifier`; otherwise *anyone* can call `fulfill(...)` directly with
///      made-up arguments and set the price to whatever they want.
///
///   2. `attestedAirnode == airnode`
///      `AirnodeVerifier` confirms the signature recovers to `attestedAirnode`, but that
///      address is supplied by the submitter — it could be any address whose signature
///      verifies. Pin the specific Airnode you trust.
///
///   3. `attestedEndpointId == endpointId`
///      A given Airnode signs many endpoints. Without this, an attacker can feed this
///      consumer data from a *different* endpoint of the same Airnode (a different asset,
///      a feed with different encoding, …). The endpoint ID also commits to the
///      endpoint's encoding spec, so pinning it pins the `abi.decode` shape used below.
///
///   4. Freshness: `attestedAt <= block.timestamp` and `block.timestamp - attestedAt <= maxStaleness`
///      A signed payload never expires on its own — anyone can replay an old one forever.
///      If freshness matters (it almost always does), bound it. Reject future-dated
///      timestamps too (a clock-skewed or manipulated Airnode).
contract AirnodePriceConsumer {
  /// @notice The `AirnodeVerifier` deployment this consumer accepts callbacks from.
  address public immutable verifier;
  /// @notice The Airnode (signer address) this consumer trusts.
  address public immutable airnode;
  /// @notice The endpoint ID the data must come from.
  bytes32 public immutable endpointId;
  /// @notice Maximum accepted age of the data, in seconds, relative to `block.timestamp`.
  uint256 public immutable maxStaleness;

  /// @notice The latest accepted value.
  int256 public latestPrice;
  /// @notice The Airnode timestamp the latest value was produced at.
  uint256 public latestTimestamp;

  event PriceUpdated(int256 price, uint256 timestamp, bytes32 requestHash);

  error ZeroAddress();
  error NotVerifier(address caller);
  error UntrustedAirnode(address attested);
  error WrongEndpoint(bytes32 attested);
  error TimestampInFuture(uint256 attestedAt);
  error DataTooStale(uint256 attestedAt, uint256 deadline);

  constructor(address airnodeVerifier, address trustedAirnode, bytes32 trustedEndpointId, uint256 maxAgeSeconds) {
    if (airnodeVerifier == address(0) || trustedAirnode == address(0)) revert ZeroAddress();
    verifier = airnodeVerifier;
    airnode = trustedAirnode;
    endpointId = trustedEndpointId;
    maxStaleness = maxAgeSeconds;
  }

  /// @notice `AirnodeVerifier` callback. Pass `this.fulfill.selector` as the
  ///         `callbackSelector` argument to `verifyAndFulfill`.
  /// @dev The signature must match what `AirnodeVerifier` forwards:
  ///      `(bytes32 requestHash, address airnode, bytes32 endpointId, uint256 timestamp, bytes data)`.
  function fulfill(
    bytes32 requestHash,
    address attestedAirnode,
    bytes32 attestedEndpointId,
    uint256 attestedAt,
    bytes calldata data
  ) external {
    // 1. Only the trusted AirnodeVerifier — the only caller that checked the signature.
    if (msg.sender != verifier) revert NotVerifier(msg.sender);
    // 2. Only data signed by the Airnode we trust.
    if (attestedAirnode != airnode) revert UntrustedAirnode(attestedAirnode);
    // 3. Only data from the endpoint we trust (this also pins the encoding).
    if (attestedEndpointId != endpointId) revert WrongEndpoint(attestedEndpointId);
    // 4. Freshness. block.timestamp is the clock here; miner skew (±~15s) is
    //    irrelevant against a maxStaleness measured in minutes/hours.
    // slither-disable-next-line timestamp
    if (attestedAt > block.timestamp) revert TimestampInFuture(attestedAt);
    uint256 deadline = attestedAt + maxStaleness;
    // slither-disable-next-line timestamp
    if (block.timestamp > deadline) revert DataTooStale(attestedAt, deadline);

    // Optional, but typical for a feed: ignore out-of-order delivery. (No revert — the
    // submitter shouldn't lose their tx just because a newer update already landed; and
    // AirnodeVerifier has already burned this payload's requestHash, so it can't recur.)
    if (attestedAt < latestTimestamp) return;

    int256 price = abi.decode(data, (int256));
    latestPrice = price;
    latestTimestamp = attestedAt;
    emit PriceUpdated(price, attestedAt, requestHash);
  }
}
