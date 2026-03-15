// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console } from 'forge-std/Script.sol';

contract Deploy is Script {
  function run() external {
    vm.startBroadcast();

    bytes memory rrpBytecode = vm.getCode('AirnodeRrpV2.vy');
    address rrp;
    assembly {
      rrp := create(0, add(rrpBytecode, 0x20), mload(rrpBytecode))
    }
    require(rrp != address(0), 'AirnodeRrpV2 deploy failed');
    console.log('AirnodeRrpV2 deployed at:', rrp);

    bytes memory escrowBytecode = vm.getCode('AirnodeEscrow.vy');
    address escrow;
    assembly {
      escrow := create(0, add(escrowBytecode, 0x20), mload(escrowBytecode))
    }
    require(escrow != address(0), 'AirnodeEscrow deploy failed');
    console.log('AirnodeEscrow deployed at:', escrow);

    vm.stopBroadcast();
  }
}
