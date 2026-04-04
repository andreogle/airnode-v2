// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console } from 'forge-std/Script.sol';
import { AirnodeVerifier } from '../src/AirnodeVerifier.sol';

contract Deploy is Script {
  function run() external {
    vm.startBroadcast();

    AirnodeVerifier verifier = new AirnodeVerifier();
    console.log('AirnodeVerifier deployed at:', address(verifier));

    vm.stopBroadcast();
  }
}
