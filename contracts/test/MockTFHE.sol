// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ITFHE } from '../src/examples/ITFHE.sol';

/// @notice Mock TFHE implementation for testing ConfidentialPriceFeed.
///         Simulates handle registration and ACL management without the FHE
///         coprocessor. Handles are sequential uint256 IDs.
contract MockTFHE is ITFHE {
  uint256 public nextHandle = 1;

  /// @notice Tracks which (handle, account) pairs have been granted access.
  mapping(uint256 => mapping(address => bool)) public acl;

  /// @notice Tracks which contract created each handle (only the creator can manage ACL).
  mapping(uint256 => address) public handleOwner;

  /// @notice Last registered handle reference, for test assertions.
  bytes32 public lastHandleRef;
  bytes public lastInputProof;

  function asEuint256(bytes32 handleRef, bytes calldata inputProof) external returns (uint256 handle) {
    lastHandleRef = handleRef;
    lastInputProof = inputProof;

    handle = nextHandle++;
    handleOwner[handle] = msg.sender;
  }

  function allow(uint256 handle, address account) external {
    require(handleOwner[handle] == msg.sender, 'Not handle owner');
    acl[handle][account] = true;
  }

  function deny(uint256 handle, address account) external {
    require(handleOwner[handle] == msg.sender, 'Not handle owner');
    acl[handle][account] = false;
  }
}
