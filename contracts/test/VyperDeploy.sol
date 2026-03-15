// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from 'forge-std/Test.sol';

abstract contract VyperDeploy is Test {
  function deployVyper(string memory fileName) internal returns (address) {
    return deployVyperWithArgs(fileName, '');
  }

  function deployVyperWithArgs(string memory fileName, bytes memory args) internal returns (address) {
    string[] memory cmds = new string[](8);
    cmds[0] = 'vyper';
    cmds[1] = '-p';
    cmds[2] = 'lib/snekmate/src';
    cmds[3] = string.concat('src/', fileName, '.vy');
    cmds[4] = '--evm-version';
    cmds[5] = 'prague';
    cmds[6] = '--optimize';
    cmds[7] = 'gas';

    bytes memory bytecode = vm.ffi(cmds);
    require(bytecode.length > 0, 'Vyper compilation failed');

    // Append constructor args to bytecode
    if (args.length > 0) {
      bytecode = abi.encodePacked(bytecode, args);
    }

    address deployed;
    assembly {
      deployed := create(0, add(bytecode, 0x20), mload(bytecode))
    }
    require(deployed != address(0), 'Vyper deployment failed');
    return deployed;
  }
}
