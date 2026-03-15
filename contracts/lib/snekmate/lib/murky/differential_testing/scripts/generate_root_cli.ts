import { toBuffer } from 'ethereumjs-util';
import { ethers } from 'ethers';
import MerkleTree from './merkle-tree';

const encoder = ethers.utils.defaultAbiCoder;
const number_leaves = process.argv[2];
const encoded_leaves = process.argv[3];
const decoded_data = encoder.decode([`bytes32[${number_leaves}]`], encoded_leaves)[0]
const dataAsBuffer = decoded_data.map(b => toBuffer(b));

const tree = new MerkleTree(dataAsBuffer);
process.stdout.write(ethers.utils.defaultAbiCoder.encode(['bytes32'], [tree.getRoot()]));


