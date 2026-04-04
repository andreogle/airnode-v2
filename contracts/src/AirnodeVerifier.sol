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
///   - Replay protection: each (endpointId, timestamp, data) combination can only
///     be fulfilled once.
///   - The callback receives (requestHash, airnode, endpointId, timestamp, data)
///     so it has all the context it needs to validate and process the data.
///   - If the callback reverts, the fulfillment is still recorded. This prevents
///     griefing where a callback intentionally reverts to block fulfillment.
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
  /// @notice Tracks fulfilled requests to prevent replay. The key is the hash of the
  ///         signed message, which is unique per (endpointId, timestamp, data) combination.
  mapping(bytes32 => bool) public fulfilled;

  // ===========================================================================
  // External functions
  // ===========================================================================

  /// @notice Verify an Airnode signature and forward the data to a callback.
  /// @param airnode The airnode address that should have signed the data.
  /// @param endpointId The specification-bound endpoint ID.
  /// @param timestamp The timestamp included in the signature.
  /// @param data The ABI-encoded response data.
  /// @param signature The EIP-191 personal signature (65 bytes: r || s || v).
  /// @param callbackAddress The contract to forward the data to. Must not be zero.
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

    // Derive the message hash: keccak256(encodePacked(endpointId, timestamp, data))
    bytes32 messageHash = keccak256(abi.encodePacked(endpointId, timestamp, data));

    // Apply EIP-191 prefix and recover the signer
    bytes32 ethSignedHash = keccak256(abi.encodePacked('\x19Ethereum Signed Message:\n32', messageHash));
    address recovered = _recover(ethSignedHash, signature);
    require(recovered == airnode, 'Signature mismatch');

    // Prevent replay — each unique message can only be fulfilled once
    require(!fulfilled[messageHash], 'Already fulfilled');
    fulfilled[messageHash] = true;

    // Emit before external interaction (checks-effects-interactions pattern)
    emit Fulfilled(messageHash, airnode, endpointId, timestamp, callbackAddress);

    // Forward to callback via the caller-specified selector. We use a low-level
    // call because the selector is dynamic — there is no fixed interface. The
    // return value is intentionally discarded: if the callback reverts, the
    // fulfillment is still recorded to prevent griefing.
    // slither-disable-next-line low-level-calls,unchecked-lowlevel
    callbackAddress.call(abi.encodeWithSelector(callbackSelector, messageHash, airnode, endpointId, timestamp, data));
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
