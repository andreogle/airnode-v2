const { StandardMerkleTree } = require("@openzeppelin/merkle-tree");
const { AbiCoder } = require("ethers");
const elements = require("./elements.js");
const merkleTree = StandardMerkleTree.of(
  elements.map((c) => [c]),
  ["string"],
);

const index = require("./multiproof-indices.js");
const { proofFlags } = merkleTree.getMultiProof(index);

 
process.stdout.write(
  AbiCoder.defaultAbiCoder().encode(Array.from({length: 10}).fill("bool"), proofFlags),
);
