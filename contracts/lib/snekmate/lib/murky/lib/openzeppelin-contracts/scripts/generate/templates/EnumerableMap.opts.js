const { capitalize } = require('../../helpers');

const mapType = string_ => (string_ == 'uint256' ? 'Uint' : capitalize(string_));

const formatType = (keyType, valueType) => ({
  name: `${mapType(keyType)}To${mapType(valueType)}Map`,
  keyType,
  valueType,
});

const TYPES = ['uint256', 'address', 'bytes32']
  .flatMap((key, _, array) => array.map(value => [key, value]))
  .slice(0, -1) // remove bytes32 → byte32 (last one) that is already defined
  .map(arguments_ => formatType(...arguments_));

module.exports = {
  TYPES,
  formatType,
};
