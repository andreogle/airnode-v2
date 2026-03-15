const keccak256 = require("keccak256");
const elements = require("./elements.js");

// For demonstration, it is also possible to create valid proofs for certain 64-byte values *not* in `elements`
const noSuchLeaf =
  `0x${ 
  keccak256(
     
    Buffer.concat(
       
      [keccak256(elements[0]), keccak256(elements[1])].sort(Buffer.compare),
    ),
  ).toString("hex")}`;

 
process.stdout.write(noSuchLeaf);
