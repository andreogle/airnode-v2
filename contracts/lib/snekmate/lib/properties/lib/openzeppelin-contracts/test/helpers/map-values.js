function mapValues(object, function_) {
  return Object.fromEntries([...Object.entries(object)].map(([k, v]) => [k, function_(v)]));
}

module.exports = {
  mapValues,
};
