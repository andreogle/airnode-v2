import crypto from 'node:crypto';
import * as fs from 'node:fs';
import { toBuffer } from 'ethereumjs-util';
import { ethers } from 'ethers';
import MerkleTree from './merkle-tree';

const data = [];
for (let index = 0; index < 129; ++index) {
    data.push(`0x${  crypto.randomBytes(32).toString('hex')}`);
}
const dataAsBuffer = data.map(b => toBuffer(b));

const tree = new MerkleTree(dataAsBuffer);
process.stdout.write(ethers.utils.defaultAbiCoder.encode(['bytes32'], [tree.getRoot()]));
const encodedData = ethers.utils.defaultAbiCoder.encode(["bytes32[129]"], [data]);
if (!fs.existsSync("../data/")) {
    fs.mkdirSync("../data/");
}
fs.writeFileSync("../data/merkle_input.txt", encodedData);

