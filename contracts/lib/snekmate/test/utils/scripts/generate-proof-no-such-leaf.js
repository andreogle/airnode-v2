const { AbiCoder } = require("ethers");
const keccak256 = require("keccak256");
const { MerkleTree } = require("merkletreejs");
const elements = require("./elements.js");
const merkleTree = new MerkleTree(elements, keccak256, {
  hashLeaves: true,
  sortPairs: true,
});

const leaf = `0x${  keccak256(elements[0]).toString("hex")}`;
const proof = merkleTree.getHexProof(leaf);

 
process.stdout.write(
  AbiCoder.defaultAbiCoder().encode(Array.from({length: 7}).fill("bytes32"), proof),
);
