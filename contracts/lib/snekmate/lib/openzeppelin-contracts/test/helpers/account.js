const { impersonateAccount, setBalance } = require('@nomicfoundation/hardhat-network-helpers');
const { ethers } = require('hardhat');

// Hardhat default balance
const DEFAULT_BALANCE = 10_000n * ethers.WeiPerEther;

const impersonate = (account, balance = DEFAULT_BALANCE) =>
  impersonateAccount(account)
    .then(() => setBalance(account, balance))
    .then(() => ethers.getSigner(account));

module.exports = {
  impersonate,
};
