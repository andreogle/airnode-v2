// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ITFHE } from './ITFHE.sol';

/// @title ConfidentialPriceFeed — Example FHE-encrypted oracle consumer
/// @notice Demonstrates how an application contract receives FHE-encrypted data
///         from Airnode via the standard AirnodeVerifier callback pattern.
///
///         This is an EXAMPLE — not a core Airnode contract. It shows one way an
///         application developer might consume encrypted oracle data. The actual
///         access control logic (who can decrypt, under what conditions) is entirely
///         up to the application.
///
///   Data flow:
///   1. Client requests signed data from Airnode's HTTP endpoint.
///   2. The fhe-encrypt plugin encrypts the response with the chain's FHE public
///      key, packing (einput, inputProof) into the data field.
///   3. Airnode signs the ciphertext — the signature proves the encrypted data is
///      authentically from the API provider.
///   4. Client submits the signed data to AirnodeVerifier.verifyAndFulfill(),
///      which verifies the signature and forwards to this contract's fulfill().
///   5. This contract registers the FHE handle and manages decryption access.
///
///   Trust model:
///   - Only the AirnodeVerifier can call fulfill() (enforced by msg.sender check).
///   - Only airnodes in the trust set are accepted (operator-configured).
///   - Only the owner can grant/revoke decryption access. The submitter, the
///     relayer, and other users have no ability to authorize themselves.
///   - The FHE coprocessor enforces that only this contract can call allow() on
///     handles it created — even if a malicious contract knows the handle ID,
///     it cannot grant itself access.
///
///   On fhEVM-compatible chains, replace ITFHE with the real TFHE library and
///   use native encrypted types (euint256) instead of uint256 handles.
contract ConfidentialPriceFeed {
  // ===========================================================================
  // Events
  // ===========================================================================
  event PriceUpdated(bytes32 indexed endpointId, uint256 handle, uint256 timestamp);
  event AccessGranted(bytes32 indexed endpointId, address indexed account);
  event AccessRevoked(bytes32 indexed endpointId, address indexed account);
  event AirnodeTrusted(address indexed airnode);
  event AirnodeRemoved(address indexed airnode);

  // ===========================================================================
  // Storage
  // ===========================================================================
  address public immutable OWNER;
  address public immutable VERIFIER;
  ITFHE public immutable TFHE;

  /// @notice Trusted airnode addresses. Only data signed by these airnodes is accepted.
  mapping(address => bool) public trustedAirnodes;

  /// @notice Latest encrypted price handle per endpoint.
  mapping(bytes32 => uint256) public prices;

  /// @notice Timestamp of the latest price update per endpoint.
  mapping(bytes32 => uint256) public timestamps;

  // ===========================================================================
  // Constructor
  // ===========================================================================

  /// @param _verifier The AirnodeVerifier contract address.
  /// @param _tfhe The TFHE interface implementation (mock for testing, precompile on fhEVM).
  constructor(address _verifier, address _tfhe) {
    OWNER = msg.sender;
    VERIFIER = _verifier;
    TFHE = ITFHE(_tfhe);
  }

  // ===========================================================================
  // Airnode trust management
  // ===========================================================================

  function trustAirnode(address airnode) external {
    require(msg.sender == OWNER, 'Only owner');
    trustedAirnodes[airnode] = true;
    emit AirnodeTrusted(airnode);
  }

  function removeAirnode(address airnode) external {
    require(msg.sender == OWNER, 'Only owner');
    trustedAirnodes[airnode] = false;
    emit AirnodeRemoved(airnode);
  }

  // ===========================================================================
  // Callback — receives encrypted data from AirnodeVerifier
  // ===========================================================================

  /// @notice Called by AirnodeVerifier after signature verification.
  ///         The data field contains abi.encode(bytes32 handleRef, bytes inputProof)
  ///         packed by the fhe-encrypt plugin.
  /// @param airnode The airnode that signed the data.
  /// @param endpointId The endpoint the data came from.
  /// @param timestamp When the data was fetched.
  /// @param data The FHE-encrypted payload (handleRef + inputProof).
  function fulfill(
    bytes32 /* requestHash */,
    address airnode,
    bytes32 endpointId,
    uint256 timestamp,
    bytes calldata data
  ) external {
    require(msg.sender == VERIFIER, 'Only verifier');
    require(trustedAirnodes[airnode], 'Untrusted airnode');
    require(timestamp > timestamps[endpointId], 'Stale data');

    // Unpack the FHE-encrypted payload
    (bytes32 handleRef, bytes memory inputProof) = abi.decode(data, (bytes32, bytes));

    // Register the FHE handle — validates the ZK proof and creates a ciphertext
    // reference in the coprocessor. Only this contract gets initial access.
    uint256 handle = TFHE.asEuint256(handleRef, inputProof);
    TFHE.allow(handle, address(this));

    prices[endpointId] = handle;
    timestamps[endpointId] = timestamp;

    emit PriceUpdated(endpointId, handle, timestamp);
  }

  // ===========================================================================
  // Decryption access control — only the owner decides who can read prices
  // ===========================================================================

  /// @notice Grant an address permission to decrypt a price.
  ///         The granted address can request decryption from the KMS nodes, who
  ///         will check this on-chain ACL before cooperating.
  /// @param endpointId The endpoint whose price to grant access to.
  /// @param account The address to authorize for decryption.
  function grantAccess(bytes32 endpointId, address account) external {
    require(msg.sender == OWNER, 'Only owner');
    require(prices[endpointId] != 0, 'No price for endpoint');
    TFHE.allow(prices[endpointId], account);
    emit AccessGranted(endpointId, account);
  }

  /// @notice Revoke an address's permission to decrypt a price.
  /// @param endpointId The endpoint whose price to revoke access from.
  /// @param account The address to revoke.
  function revokeAccess(bytes32 endpointId, address account) external {
    require(msg.sender == OWNER, 'Only owner');
    require(prices[endpointId] != 0, 'No price for endpoint');
    TFHE.deny(prices[endpointId], account);
    emit AccessRevoked(endpointId, account);
  }
}
