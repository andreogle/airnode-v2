const { StandardMerkleTree } = require("@openzeppelin/merkle-tree");
const { AbiCoder } = require("ethers");
const badElements = require("./multiproof-bad-elements.js");
const merkleTree = StandardMerkleTree.of(
  badElements.map((c) => [c]),
  ["string"],
);

const index = require("./multiproof-bad-indices.js");
const { proofFlags } = merkleTree.getMultiProof(index);

 
process.stdout.write(
  AbiCoder.defaultAbiCoder().encode(Array.from({length: 7}).fill("bool"), proofFlags),
);
