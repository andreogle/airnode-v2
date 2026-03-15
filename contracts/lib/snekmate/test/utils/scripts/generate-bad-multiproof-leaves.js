const { StandardMerkleTree } = require("@openzeppelin/merkle-tree");
const { AbiCoder } = require("ethers");
const badElements = require("./multiproof-bad-elements.js");
const merkleTree = StandardMerkleTree.of(
  badElements.map((c) => [c]),
  ["string"],
);

const index = require("./multiproof-bad-indices.js");
const { leaves } = merkleTree.getMultiProof(index);
const hashedBadLeaves = leaves.map((c) => merkleTree.leafHash(c));

 
process.stdout.write(
  AbiCoder.defaultAbiCoder().encode(Array.from({length: 3}).fill("bytes32"), hashedBadLeaves),
);
