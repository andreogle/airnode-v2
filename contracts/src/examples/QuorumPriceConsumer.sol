// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title QuorumPriceConsumer
/// @notice Example consumer that requires several trusted Airnodes to sign the exact
///         same endpoint, timestamp, and encoded value before publishing a price.
/// @dev A quorum reduces dependence on one signing key only when the Airnodes are
///      operated independently and obtain observations independently. It does not
///      prove upstream truth, and exact-match quorum may not suit volatile feeds.
///      A strict majority prevents disjoint quorums, assuming an honest Airnode does
///      not sign conflicting values for the same endpoint and timestamp. Partial
///      confirmations remain in storage, so use this for bounded trusted signer sets.
contract QuorumPriceConsumer {
  address public immutable verifier;
  bytes32 public immutable endpointId;
  uint256 public immutable threshold;
  uint256 public immutable maxStaleness;

  mapping(address => bool) public trustedAirnodes;
  mapping(bytes32 => uint256) public confirmations;
  mapping(bytes32 => mapping(address => bool)) public confirmedBy;
  mapping(bytes32 => bool) public finalized;

  int256 public latestPrice;
  uint256 public latestTimestamp;

  event AttestationConfirmed(bytes32 indexed requestHash, address indexed airnode, uint256 confirmations);
  event PriceUpdated(int256 price, uint256 timestamp, bytes32 indexed requestHash);

  error ZeroAddress();
  error VerifierHasNoCode();
  error InvalidThreshold();
  error DuplicateAirnode(address airnode);
  error NotVerifier(address caller);
  error UntrustedAirnode(address airnode);
  error WrongEndpoint(bytes32 endpointId);
  error TimestampInFuture(uint256 timestamp);
  error DataTooStale(uint256 timestamp);
  error InvalidRequestHash();
  error AlreadyConfirmed(bytes32 requestHash, address airnode);

  constructor(
    address airnodeVerifier,
    bytes32 trustedEndpointId,
    address[] memory airnodes,
    uint256 requiredConfirmations,
    uint256 maxAgeSeconds
  ) {
    if (airnodeVerifier == address(0)) revert ZeroAddress();
    if (airnodeVerifier.code.length == 0) revert VerifierHasNoCode();
    if (requiredConfirmations <= airnodes.length / 2 || requiredConfirmations > airnodes.length) {
      revert InvalidThreshold();
    }

    verifier = airnodeVerifier;
    endpointId = trustedEndpointId;
    threshold = requiredConfirmations;
    maxStaleness = maxAgeSeconds;

    for (uint256 i = 0; i < airnodes.length; i++) {
      address airnode = airnodes[i];
      if (airnode == address(0)) revert ZeroAddress();
      if (trustedAirnodes[airnode]) revert DuplicateAirnode(airnode);
      trustedAirnodes[airnode] = true;
    }
  }

  /// @notice AirnodeVerifier callback. Every confirmation for a request hash commits
  ///         to the same endpoint ID, timestamp, and data bytes.
  function fulfill(
    bytes32 requestHash,
    address attestedAirnode,
    bytes32 attestedEndpointId,
    uint256 attestedAt,
    bytes calldata data
  ) external {
    if (msg.sender != verifier) revert NotVerifier(msg.sender);
    if (!trustedAirnodes[attestedAirnode]) revert UntrustedAirnode(attestedAirnode);
    if (attestedEndpointId != endpointId) revert WrongEndpoint(attestedEndpointId);
    // slither-disable-next-line timestamp
    if (attestedAt > block.timestamp) revert TimestampInFuture(attestedAt);
    // slither-disable-next-line timestamp
    if (block.timestamp - attestedAt > maxStaleness) revert DataTooStale(attestedAt);
    if (requestHash != keccak256(abi.encodePacked(attestedEndpointId, attestedAt, data))) revert InvalidRequestHash();

    // A late observation cannot roll back or replace an equally recent finalized value.
    if (attestedAt <= latestTimestamp || finalized[requestHash]) return;
    if (confirmedBy[requestHash][attestedAirnode]) revert AlreadyConfirmed(requestHash, attestedAirnode);

    confirmedBy[requestHash][attestedAirnode] = true;
    uint256 count = confirmations[requestHash] + 1;
    confirmations[requestHash] = count;
    emit AttestationConfirmed(requestHash, attestedAirnode, count);

    if (count < threshold) return;

    int256 price = abi.decode(data, (int256));
    finalized[requestHash] = true;
    latestPrice = price;
    latestTimestamp = attestedAt;
    emit PriceUpdated(price, attestedAt, requestHash);
  }
}
