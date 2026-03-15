const { ethers } = require('ethers');

const Enum = (...options) => Object.fromEntries(options.map((key, index) => [key, BigInt(index)]));
const EnumTyped = (...options) => Object.fromEntries(options.map((key, index) => [key, ethers.Typed.uint8(index)]));

module.exports = {
  Enum,
  EnumTyped,
  ProposalState: Enum('Pending', 'Active', 'Canceled', 'Defeated', 'Succeeded', 'Queued', 'Expired', 'Executed'),
  VoteType: Object.assign(Enum('Against', 'For', 'Abstain'), { Parameters: 255n }),
  Rounding: EnumTyped('Floor', 'Ceil', 'Trunc', 'Expand'),
  OperationState: Enum('Unset', 'Waiting', 'Ready', 'Done'),
  RevertType: EnumTyped('None', 'RevertWithoutMessage', 'RevertWithMessage', 'RevertWithCustomError', 'Panic'),
};
