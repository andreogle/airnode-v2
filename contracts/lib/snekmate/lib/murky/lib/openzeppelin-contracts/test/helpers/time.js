const { time, mine, mineUpTo } = require('@nomicfoundation/hardhat-network-helpers');
const { ethers } = require('hardhat');
const { mapValues } = require('./iterate');

const clock = {
  blocknumber: () => time.latestBlock().then(ethers.toBigInt),
  timestamp: () => time.latest().then(ethers.toBigInt),
};
const clockFromReceipt = {
  blocknumber: receipt => Promise.resolve(ethers.toBigInt(receipt.blockNumber)),
  timestamp: receipt => ethers.provider.getBlock(receipt.blockNumber).then(block => ethers.toBigInt(block.timestamp)),
};
const increaseBy = {
  blockNumber: mine,
  timestamp: (delay, mine = true) =>
    time.latest().then(clock => increaseTo.timestamp(clock + ethers.toNumber(delay), mine)),
};
const increaseTo = {
  blocknumber: mineUpTo,
  timestamp: (to, mine = true) => (mine ? time.increaseTo(to) : time.setNextBlockTimestamp(to)),
};
const duration = mapValues(time.duration, function_ => n => ethers.toBigInt(function_(ethers.toNumber(n))));

module.exports = {
  clock,
  clockFromReceipt,
  increaseBy,
  increaseTo,
  duration,
};
