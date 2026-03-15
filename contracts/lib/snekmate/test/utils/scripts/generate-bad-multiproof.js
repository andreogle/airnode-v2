const { StandardMerkleTree } = require("@openzeppelin/merkle-tree");
const { AbiCoder } = require("ethers");
const badElements = require("./multiproof-bad-elements.js");
const merkleTree = StandardMerkleTree.of(
  badElements.map((c) => [c]),
  ["string"],
);

const index = require("./multiproof-bad-indices.js");
const { proof } = merkleTree.getMultiProof(index);

 
process.stdout.write(
  AbiCoder.defaultAbiCoder().encode(Array.from({length: 5}).fill("bytes32"), proof),
);
