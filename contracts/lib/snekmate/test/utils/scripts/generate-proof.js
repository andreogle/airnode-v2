const { StandardMerkleTree } = require("@openzeppelin/merkle-tree");
const { AbiCoder } = require("ethers");
const elements = require("./elements.js");
const merkleTree = StandardMerkleTree.of(
  elements.map((c) => [c]),
  ["string"],
);

const proof = merkleTree.getProof([elements[0]]);

 
process.stdout.write(
  AbiCoder.defaultAbiCoder().encode(Array.from({length: 6}).fill("bytes32"), proof),
);
