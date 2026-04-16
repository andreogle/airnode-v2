// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ITFHE — Minimal fhEVM interface for compilation and testing
/// @notice On fhEVM-compatible chains (Ethereum + Zama coprocessor), replace this
///         with the real fhEVM library:
///
///           forge install zama-ai/fhevm
///           import "fhevm/lib/TFHE.sol";
///
///         The real TFHE is a Solidity library that calls chain-level precompiles.
///         This interface abstracts those calls so contracts can be compiled and
///         tested with a mock implementation without the fhEVM dependency.
///
///         Handle values (uint256) are opaque references to ciphertexts stored by
///         the FHE coprocessor. They cannot be read or manipulated directly — only
///         the coprocessor can operate on the underlying encrypted data.
interface ITFHE {
  /// @notice Register a raw encrypted input as an FHE handle.
  ///         On real fhEVM, this validates the ZK proof of encryption and creates
  ///         a ciphertext handle that the coprocessor can operate on.
  /// @param handleRef The encrypted input reference (einput in fhEVM).
  /// @param inputProof The zero-knowledge proof that the ciphertext is well-formed.
  /// @return handle An opaque handle to the encrypted value.
  function asEuint256(bytes32 handleRef, bytes calldata inputProof) external returns (uint256 handle);

  /// @notice Grant an address permission to decrypt a handle.
  ///         Only the contract that created the handle (via asEuint256) can call this.
  ///         The KMS nodes check this ACL before performing threshold decryption.
  /// @param handle The FHE handle to grant access to.
  /// @param account The address that should be able to decrypt.
  function allow(uint256 handle, address account) external;

  /// @notice Revoke an address's permission to decrypt a handle.
  /// @param handle The FHE handle to revoke access from.
  /// @param account The address to revoke.
  function deny(uint256 handle, address account) external;
}
