const keccak256 = require("keccak256");
const { MerkleTree } = require("merkletreejs");
const elements = require("./elements.js");
const merkleTree = new MerkleTree(elements, keccak256, {
  hashLeaves: true,
  sortPairs: true,
});

const root = merkleTree.getHexRoot();

 
process.stdout.write(root);
