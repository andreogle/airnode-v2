const { StandardMerkleTree } = require("@openzeppelin/merkle-tree");
const { AbiCoder } = require("ethers");
const elements = require("./elements.js");
const merkleTree = StandardMerkleTree.of(
  elements.map((c) => [c]),
  ["string"],
);

const index = require("./multiproof-indices.js");
const { leaves } = merkleTree.getMultiProof(index);
const hashedLeaves = leaves.map((c) => merkleTree.leafHash(c));

 
process.stdout.write(
  AbiCoder.defaultAbiCoder().encode(Array.from({length: 3}).fill("bytes32"), hashedLeaves),
);
