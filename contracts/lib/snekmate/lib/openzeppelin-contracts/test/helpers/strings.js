module.exports = {
  // Capitalize the first char of a string
  // Example: capitalize('uint256') → 'Uint256'
  capitalize: string_ => string_.charAt(0).toUpperCase() + string_.slice(1),
};
