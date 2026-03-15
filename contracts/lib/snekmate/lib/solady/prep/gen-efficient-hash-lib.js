#!/usr/bin/env node
const { genSectionRegex, readSync, writeAndFmtSync, normalizeNewlines, hexNoPrefix } = require('./common.js');

async function main() {
  const sourcePath = 'src/utils/EfficientHashLib.sol';
  const maxDepth = 14;
  let source = readSync(sourcePath);

  const genHashDef = (t, n) => {
    let s = '/// @dev Returns `keccak256(abi.encode(';
    const a = [];
    for (let index = 0; index < n; ++index) a.push(`${t  } v${  index}`);
    const b = (n > 4 ? [a[0], '..', a[n - 1]] : a).join(', ');
    s += b.replaceAll(new RegExp(`${t  } `, 'g'), '');
    s += `))\`.\nfunction hash(${  a.join(', ')}`;
    s += ') internal pure returns (bytes32 result) {\n';
    s += '/// @solidity memory-safe-assembly\nassembly {\n';
    if (n == 1) {
      s += 'mstore(0x00, v0)\nresult := keccak256(0x00, 0x20)}}\n'
    } else if (n == 2) {
      s += 'mstore(0x00, v0)\nmstore(0x20, v1)\nresult := keccak256(0x00, 0x40)}}\n'
    } else {
      s += 'let m := mload(0x40)\nmstore(m, v0)\n';
      for (let index = 1; index < n; ++index) {
        s += `mstore(add(m, 0x${  hexNoPrefix(index << 5)  }), v${  index  })\n`;
      }
      s += `result := keccak256(m, 0x${  hexNoPrefix(n << 5) })}}\n`;
    }
    return s;
  };

  source = source.replace(
    genSectionRegex('MALLOC-LESS HASHING OPERATIONS'),
    (m0, m1, m2) => {
      const chunks = [m1];
      for (let index = 1; index <= maxDepth; ++index) {
        chunks.push(genHashDef('bytes32', index));
        chunks.push(genHashDef('uint256', index));
      }
      chunks.push(m2);
      return normalizeNewlines(chunks.join('\n\n\n'));
    }
  );
  writeAndFmtSync(sourcePath, source);
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
