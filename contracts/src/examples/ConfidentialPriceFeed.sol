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
///   1. Client requests signed data from Airnode's HTTP endpoint (an endpoint
///      configured with an `encrypt` block).
///   2. Airnode encrypts the encoded response with the chain's FHE public key,
///      packing (handle, inputProof) into the data field.
///   3. Airnode signs the ciphertext. The signature identifies the Airnode key;
///      trusting that signer and its upstream data remains an application decision.
///   4. Client submits the signed data to AirnodeVerifier.verifyAndFulfill(),
///      which verifies the signature and forwards to this contract's fulfill().
///   5. This contract registers the FHE handle and manages decryption access.
///
///   Trust model:
///   - Only the AirnodeVerifier can call fulfill() (enforced by msg.sender check).
///   - Only airnodes in the trust set are accepted (operator-configured).
///   - Only the owner can grant persistent decryption access. Current FHE ACL
///     grants are not revocable, so applications should grant them sparingly.
///   - The FHE coprocessor enforces that only this contract can call allow() on
///     handles it created — even if a malicious contract knows the handle ID,
///     it cannot grant itself access.
///   - This example trusts the configured ITFHE adapter to validate proofs and
///     enforce ciphertext binding. MockTFHE provides no cryptographic guarantee.
///
///   On FHEVM-compatible chains, replace ITFHE with the current FHEVM Solidity
///   package and use its native encrypted and external input types instead of
///   uint256 handles. Note: an fhEVM encrypted input is bound to the contract
///   that ingests it AND to that contract's msg.sender at ingestion time. Here
///   fulfill() is called by AirnodeVerifier, so the airnode must have encrypted
///   the input for (this contract, AirnodeVerifier) — i.e. the operator's
///   `settings.fhe.verifier` must be the AirnodeVerifier address used here.
contract ConfidentialPriceFeed {
  // ===========================================================================
  // Events
  // ===========================================================================
  event PriceUpdated(bytes32 indexed endpointId, uint256 handle, uint256 timestamp);
  event AccessGranted(bytes32 indexed endpointId, address indexed account);

  event AirnodeTrusted(address indexed airnode);
  event AirnodeRemoved(address indexed airnode);

  // ===========================================================================
  // Storage
  // ===========================================================================
  address public immutable owner;
  address public immutable verifier;
  ITFHE public immutable tfhe;
  uint256 public immutable maxStaleness;

  /// @notice Trusted airnode addresses. Only data signed by these airnodes is accepted.
  mapping(address => bool) public trustedAirnodes;

  /// @notice Latest encrypted price handle per endpoint.
  mapping(bytes32 => uint256) public prices;

  /// @notice Timestamp of the latest price update per endpoint.
  mapping(bytes32 => uint256) public timestamps;

  /// @dev Reentrancy guard. 1 = not entered, 2 = entered.
  uint256 private locked = 1;

  modifier nonReentrant() {
    require(locked == 1, 'Reentrant call');
    locked = 2;
    _;
    locked = 1;
  }

  // ===========================================================================
  // Constructor
  // ===========================================================================

  /// @param _verifier The AirnodeVerifier contract address.
  /// @param _tfhe The TFHE interface implementation (mock for testing, precompile on fhEVM).
  /// @param _maxStaleness Maximum accepted age of an Airnode timestamp, in seconds.
  constructor(address _verifier, address _tfhe, uint256 _maxStaleness) {
    require(_verifier != address(0), 'Verifier is zero');
    require(_tfhe != address(0), 'TFHE is zero');
    require(_verifier.code.length != 0, 'Verifier has no code');
    require(_tfhe.code.length != 0, 'FHE adapter has no code');
    owner = msg.sender;
    verifier = _verifier;
    tfhe = ITFHE(_tfhe);
    maxStaleness = _maxStaleness;
  }

  // ===========================================================================
  // Airnode trust management
  // ===========================================================================

  function trustAirnode(address airnode) external {
    require(msg.sender == owner, 'Only owner');
    require(airnode != address(0), 'Airnode is zero');
    trustedAirnodes[airnode] = true;
    emit AirnodeTrusted(airnode);
  }

  function removeAirnode(address airnode) external {
    require(msg.sender == owner, 'Only owner');
    trustedAirnodes[airnode] = false;
    emit AirnodeRemoved(airnode);
  }

  // ===========================================================================
  // Callback — receives encrypted data from AirnodeVerifier
  // ===========================================================================

  /// @notice Called by AirnodeVerifier after signature verification.
  ///         The data field contains abi.encode(bytes32 handleRef, bytes inputProof)
  ///         packed by Airnode's FHE encryption.
  /// @param airnode The airnode that signed the data.
  /// @param endpointId The endpoint the data came from.
  /// @param timestamp The timestamp Airnode included when signing the data.
  /// @param data The FHE-encrypted payload (handleRef + inputProof).
  function fulfill(
    bytes32 /* requestHash */,
    address airnode,
    bytes32 endpointId,
    uint256 timestamp,
    bytes calldata data
  ) external nonReentrant {
    require(msg.sender == verifier, 'Only verifier');
    require(trustedAirnodes[airnode], 'Untrusted airnode');
    // Airnode timestamps are trusted only within this application-defined window.
    // slither-disable-next-line timestamp
    require(timestamp <= block.timestamp, 'Future timestamp');
    // slither-disable-next-line timestamp
    require(block.timestamp - timestamp <= maxStaleness, 'Data too stale');
    require(timestamp > timestamps[endpointId], 'Stale data');

    // Effects before interactions (CEI): bumping the timestamp first blocks any
    // reentrant call with a stale or equal timestamp from being accepted.
    timestamps[endpointId] = timestamp;

    // Unpack the FHE-encrypted payload
    (bytes32 handleRef, bytes memory inputProof) = abi.decode(data, (bytes32, bytes));

    // Register the FHE handle — validates the ZK proof and creates a ciphertext
    // reference in the coprocessor. Only this contract gets initial access.
    uint256 handle = tfhe.fromExternal(handleRef, inputProof);
    tfhe.allow(handle, address(this));

    // The handle is only known after the external call, so this write is unavoidably
    // after the interaction. Reentrancy is prevented by the nonReentrant modifier.
    // slither-disable-next-line reentrancy-benign
    prices[endpointId] = handle;

    emit PriceUpdated(endpointId, handle, timestamp);
  }

  // ===========================================================================
  // Decryption access control — only the owner can grant persistent access
  // ===========================================================================

  /// @notice Grant an address permission to decrypt a price.
  ///         The granted address can request decryption from the KMS nodes, who
  ///         will check this on-chain ACL before cooperating.
  /// @param endpointId The endpoint whose price to grant access to.
  /// @param account The address to authorize for decryption.
  function grantAccess(bytes32 endpointId, address account) external nonReentrant {
    require(msg.sender == owner, 'Only owner');
    require(prices[endpointId] != 0, 'No price for endpoint');
    tfhe.allow(prices[endpointId], account);
    emit AccessGranted(endpointId, account);
  }
}
