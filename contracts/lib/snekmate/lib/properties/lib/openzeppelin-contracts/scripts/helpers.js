function chunk(array, size = 1) {
  return Array.range(Math.ceil(array.length / size)).map(index => array.slice(index * size, index * size + size));
}

function range(start, stop, step = 1) {
  if (!stop) {
    stop = start;
    start = 0;
  }
  return start < stop
    ? Array.from({length: Math.ceil((stop - start) / step)})
        .fill()
        .map((_, index) => start + index * step)
    : [];
}

function unique(array, op = x => x) {
  return array.filter((object, index) => array.findIndex(entry => op(object) === op(entry)) === index);
}

function zip(...arguments_) {
  return Array.from({length: Math.max(...arguments_.map(argument => argument.length))})
    .fill(null)
    .map((_, index) => arguments_.map(argument => argument[index]));
}

function capitalize(string_) {
  return string_.charAt(0).toUpperCase() + string_.slice(1);
}

module.exports = {
  chunk,
  range,
  unique,
  zip,
  capitalize,
};
