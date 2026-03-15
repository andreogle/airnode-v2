// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Mock callback contract for AirnodeVerifier tests.
///         Records the last callback arguments for assertion.
contract MockCallback {
  bytes32 public lastRequestHash;
  address public lastAirnode;
  bytes32 public lastEndpointId;
  uint256 public lastTimestamp;
  bytes public lastData;
  uint256 public callCount;

  function fulfill(
    bytes32 requestHash,
    address airnode,
    bytes32 endpointId,
    uint256 timestamp,
    bytes calldata data
  ) external {
    lastRequestHash = requestHash;
    lastAirnode = airnode;
    lastEndpointId = endpointId;
    lastTimestamp = timestamp;
    lastData = data;
    callCount++;
  }
}

/// @notice Callback that always reverts, for testing revert_on_failure=False.
contract RevertingCallback {
  function fulfill(bytes32, address, bytes32, uint256, bytes calldata) external pure {
    revert('intentional revert');
  }
}
