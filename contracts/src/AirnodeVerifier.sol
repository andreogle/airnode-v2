// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AirnodeVerifier
/// @notice Verifies Airnode-signed data and forwards it to a callback contract.
///         This is the on-chain primitive for the "pull" path — a client gets signed
///         data from an Airnode HTTP server and submits it on-chain to trigger a
///         callback on their contract.
///
///   How it works:
///   1. Client calls an Airnode's HTTP endpoint, receives signed data.
///   2. Client (or a relayer) calls verifyAndFulfill() with the signed data.
///   3. This contract recovers the signer from the signature.
///   4. If the signer matches the provided airnode address, and the request hasn't
///      been fulfilled before, the data is forwarded to the callback contract.
///
///   Signature format:
///     hash = keccak256(abi.encodePacked(endpointId, timestamp, data))
///     signature = EIP-191 personal sign over hash
///
///   Trust model:
///   - Permissionless: anyone can submit signed data (client, relayer, airnode).
///   - The contract only verifies the signature. It does NOT check whether the
///     airnode is "legitimate" — that is the callback contract's responsibility.
///     The callback contract should maintain its own trust set of airnode addresses.
///   - Replay protection: each (airnode, endpointId, timestamp, data, callback,
///     selector) combination can only be fulfilled once. Independent airnodes
///     and consumers can deliver the same payload without blocking each other.
///   - The callback receives (requestHash, airnode, endpointId, timestamp, data)
///     so it has all the context it needs to validate and process the data.
///   - Callback failure rev...[truncated]
contract AirnodeVerifier {
  // ===========================================================================
  // Events
  // ===========================================================================
  event Fulfilled(
    bytes32 indexed requestHash,
    address indexed airnode,
    bytes32 endpointId,
    uint256 timestamp,
    address callbackAddress
  );

  // ===========================================================================
  // Storage
  // ===========================================================================
  /// @notice Indicates whether a signer/payload pair has been delivered at least once.
  mapping(address => mapping(bytes32 => bool)) public fulfilled;

  /// @notice Tracks the precise signer/payload/callback/selector delivery tuple.
  mapping(bytes32 => bool) public fulfilledDelivery;

  // ===========================================================================
  // External functions
  // ===========================================================================

  /// @notice Verify an Airnode signature and forward the data to a callback.
  /// @param airnode The airnode address that should have signed the data.
  /// @param endpointId The specification-bound endpoint ID.
  /// @param timestamp The timestamp included in the signature.
  /// @param data The ABI-encoded response data.
  /// @param signature The EIP-191 personal signature (65 bytes: r || s || v).
  /// @param callbackAddress The deployed contract to forward the data to.
  /// @param callbackSelector The function selector on the callback contract.
  function verifyAndFulfill(
    address airnode,
    bytes32 endpointId,
    uint256 timestamp,
    bytes calldata data,
    bytes calldata signature,
    address callbackAddress,
    bytes4 callbackSelector
  ) external {
    require(callbackAddress != address(0), 'Callback address is zero');
    require(callbackAddress.code.length != 0, 'Callback has no code');

    // Derive the message hash: keccak256(encodePacked(endpointId, timestamp, data))
    bytes32 messageHash = keccak256(abi.encodePacked(endpointId, timestamp, data));

    {
      // Apply EIP-191 prefix and recover the signer.
      bytes32 ethSignedHash = keccak256(abi.encodePacked('\x19Ethereum Signed Message:\n32', messageHash));
      address recovered = _recover(ethSignedHash, signature);
      require(recovered == airnode, 'Signature mismatch');
    }

    // Replay protection is scoped to the signer and callback target. Two
    // independent consumers may legitimately deliver the same attestation, and
    // a caller cannot burn it by supplying an unrelated callback or selector.
    {
      bytes32 deliveryHash = keccak256(abi.encode(airnode, messageHash, callbackAddress, callbackSelector));
      require(!fulfilledDelivery[deliveryHash], 'Already fulfilled');
      fulfilledDelivery[deliveryHash] = true;
    }
    fulfilled[airnode][messageHash] = true;

    // Emit before external interaction (checks-effects-interactions pattern)
    emit Fulfilled(messageHash, airnode, endpointId, timestamp, callbackAddress);

    // Forward to callback via the caller-specified selector. Failure must revert
    // this transaction so an underfunded or premature submission cannot consume a
    // valid payload without updating the consumer. Reverting also rolls back both
    // replay flags and the event, preserving a safe retry path.
    // slither-disable-next-line low-level-calls
    (bool success, bytes memory returndata) = callbackAddress.call(
      abi.encodeWithSelector(callbackSelector, messageHash, airnode, endpointId, timestamp, data)
    );
    if (!success) {
      // Bubble the callback's revert data. This standard assembly pattern preserves
      // custom errors and revert strings for callers.
      // slither-disable-next-line assembly
      assembly ('memory-safe') {
        revert(add(returndata, 0x20), mload(returndata))
      }
    }
  }

  // ===========================================================================
  // Internal functions
  // ===========================================================================

  /// @notice Recover the signer from an EIP-191 signature.
  /// @param hash The EIP-191 prefixed message hash.
  /// @param signature The 65-byte signature (r || s || v).
  function _recover(bytes32 hash, bytes calldata signature) internal pure returns (address) {
    require(signature.length == 65, 'Invalid signature length');

    // Decode r, s, v from the 65-byte packed signature using calldata slicing.
    bytes32 r = bytes32(signature[0:32]);
    bytes32 s = bytes32(signature[32:64]);
    uint8 v = uint8(signature[64]);

    // EIP-2 still allows signature malleability for ecrecover. Remove this
    // possibility by requiring s to be in the lower half order.
    require(uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0, 'Invalid signature s');
    require(v == 27 || v == 28, 'Invalid signature v');

    address signer = ecrecover(hash, v, r, s);
    require(signer != address(0), 'Invalid signature');

    return signer;
  }
}
