#!/usr/bin/env node
const { genSectionRegex, readSync, writeAndFmtSync, normalizeNewlines, hexNoPrefix } = require('./common.js');

async function main() {
  const sourcePath = 'src/utils/SafeCastLib.sol';
  let source = readSync(sourcePath);

  const genUint256ToUintXCastDef = index => {
    const n = index * 8;
    let s = `/// @dev Casts \`x\` to a uint${  n  }. Reverts on overflow.\n`
    s += `function toUint${  n  }(uint256 x) internal pure returns (uint${  n  }) {`;
    s += `if (x >= 1 << ${  n  }) _revertOverflow();`
    s += `return uint${  n  }(x);}\n`;
    return s;
  };

  const genInt256ToIntXCastDef = index => {
    const n = index * 8;
    const m = n - 1;
    let s = `/// @dev Casts \`x\` to a int${  n  }. Reverts on overflow.\n`
    s += `function toInt${  n  }(int256 x) internal pure returns (int${  n  }) {`;
    s += 'unchecked {';
    s += `if (((1 << ${  m  }) + uint256(x)) >> ${  n  } == uint256(0)) return int${  n  }(x);`;
    s += '_revertOverflow();}}\n';
    return s;
  };

  const genUInt256ToIntXCastDef = index => {
    const n = index * 8;
    const m = n - 1;
    let s = `/// @dev Casts \`x\` to a int${  n  }. Reverts on overflow.\n`
    s += `function toInt${  n  }(uint256 x) internal pure returns (int${  n  }) {`;
    s += `if (x >= 1 << ${  m  }) _revertOverflow();`;
    s += `return int${  n  }(int256(x));}\n`;
    return s;
  };

  source = source.replace(
    genSectionRegex('UNSIGNED INTEGER SAFE CASTING OPERATIONS'),
    (m0, m1, m2) => {
      const chunks = [m1];
      for (let index = 1; index <= 31; ++index) {
        chunks.push(genUint256ToUintXCastDef(index));
      }
      chunks.push(m2);
      return normalizeNewlines(chunks.join('\n\n\n'));
    }
  ).replace(
    genSectionRegex('SIGNED INTEGER SAFE CASTING OPERATIONS'),
    (m0, m1, m2) => {
      const chunks = [m1];
      for (let index = 1; index <= 31; ++index) {
        chunks.push(genInt256ToIntXCastDef(index));
      }
      chunks.push(m2);
      return normalizeNewlines(chunks.join('\n\n\n'));
    }
  ).replace(
    genSectionRegex('OTHER SAFE CASTING OPERATIONS'),
    (m0, m1, m2) => {
      const chunks = [m1];
      for (let index = 1; index <= 31; ++index) {
        chunks.push(genUInt256ToIntXCastDef(index));
      }
      chunks.push(
        '/// @dev Casts `x` to a int256. Reverts on overflow.\n' +
        'function toInt256(uint256 x) internal pure returns (int256) {' +
        'if (int256(x) >= 0) return int256(x);'+
        '_revertOverflow();}'
      , 
        '/// @dev Casts `x` to a uint256. Reverts on overflow.\n' +
        'function toUint256(int256 x) internal pure returns (uint256) {' +
        'if (x >= 0) return uint256(x);'+
        '_revertOverflow();}'
      , m2);
      return normalizeNewlines(chunks.join('\n\n\n'));
    }
  );
  writeAndFmtSync(sourcePath, source);
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
