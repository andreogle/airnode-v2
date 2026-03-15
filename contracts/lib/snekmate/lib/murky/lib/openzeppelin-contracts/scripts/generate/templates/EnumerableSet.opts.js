const { capitalize } = require('../../helpers');

const mapType = string_ => (string_ == 'uint256' ? 'Uint' : capitalize(string_));

const formatType = type => ({
  name: `${mapType(type)}Set`,
  type,
});

const TYPES = ['bytes32', 'address', 'uint256'].map(formatType);

module.exports = { TYPES, formatType };
