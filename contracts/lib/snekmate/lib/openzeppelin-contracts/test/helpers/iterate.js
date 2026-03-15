module.exports = {
  // ================================================= Array helpers =================================================

  // Cut an array into an array of sized-length arrays
  // Example: chunk([1,2,3,4,5,6,7,8], 3) → [[1,2,3],[4,5,6],[7,8]]
  chunk: (array, size = 1) =>
    Array.from({ length: Math.ceil(array.length / size) }, (_, index) => array.slice(index * size, index * size + size)),

  // Cartesian cross product of an array of arrays
  // Example: product([1,2],[a,b,c],[true]) → [[1,a,true],[1,b,true],[1,c,true],[2,a,true],[2,b,true],[2,c,true]]
  product: (...arrays) => arrays.reduce((a, b) => a.flatMap(ai => b.map(bi => [...ai, bi])), [[]]),

  // Range from start to end in increment
  // Example: range(17,42,7) → [17,24,31,38]
  range: (start, stop, step = 1) => {
    if (stop == undefined) {
      stop = start;
      start = 0;
    }
    return start < stop ? Array.from({ length: (stop - start + step - 1) / step }, (_, index) => start + index * step) : [];
  },

  // Unique elements, with an optional getter function
  // Example: unique([1,1,2,3,4,8,1,3,8,13,42]) → [1,2,3,4,8,13,42]
  unique: (array, op = x => x) => array.filter((object, index) => array.findIndex(entry => op(object) === op(entry)) === index),

  // Zip arrays together. If some arrays are smaller, undefined is used as a filler.
  // Example: zip([1,2],[a,b,c],[true]) → [[1,a,true],[2,b,undefined],[undefined,c,undefined]]
  zip: (...arguments_) => Array.from({ length: Math.max(...arguments_.map(argument => argument.length)) }, (_, index) => arguments_.map(argument => argument[index])),

  // ================================================ Object helpers =================================================

  // Create a new object by mapping the values through a function, keeping the keys. Second function can be used to pre-filter entries
  // Example: mapValues({a:1,b:2,c:3}, x => x**2) → {a:1,b:4,c:9}
  mapValues: (object, function_, function2 = () => true) =>
    Object.fromEntries(
      Object.entries(object)
        .filter(function2)
        .map(([k, v]) => [k, function_(v)]),
    ),
};
