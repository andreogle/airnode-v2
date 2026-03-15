const format = require('../format-lines');

// OPTIONS
const defaultOptions = size => ({
  historyTypeName: `Trace${size}`,
  checkpointTypeName: `Checkpoint${size}`,
  checkpointFieldName: '_checkpoints',
  keyTypeName: `uint${256 - size}`,
  keyFieldName: '_key',
  valueTypeName: `uint${size}`,
  valueFieldName: '_value',
});

const VALUE_SIZES = [224, 160];

const OPTS = VALUE_SIZES.map(size => defaultOptions(size));

const LEGACY_OPTS = {
  ...defaultOptions(224),
  historyTypeName: 'History',
  checkpointTypeName: 'Checkpoint',
  keyFieldName: '_blockNumber',
};

// TEMPLATE
const header = `\
pragma solidity ^0.8.0;

import "./math/Math.sol";
import "./math/SafeCast.sol";

/**
 * @dev This library defines the \`History\` struct, for checkpointing values as they change at different points in
 * time, and later looking up past values by block number. See {Votes} as an example.
 *
 * To create a history of checkpoints define a variable type \`Checkpoints.History\` in your contract, and store a new
 * checkpoint for the current transaction block using the {push} function.
 *
 * _Available since v4.5._
 */
`;

const types = options => `\
struct ${options.historyTypeName} {
    ${options.checkpointTypeName}[] ${options.checkpointFieldName};
}

struct ${options.checkpointTypeName} {
    ${options.keyTypeName} ${options.keyFieldName};
    ${options.valueTypeName} ${options.valueFieldName};
}
`;

 
const operations = options => `\
/**
 * @dev Pushes a (\`key\`, \`value\`) pair into a ${options.historyTypeName} so that it is stored as the checkpoint.
 *
 * Returns previous value and new value.
 */
function push(
    ${options.historyTypeName} storage self,
    ${options.keyTypeName} key,
    ${options.valueTypeName} value
) internal returns (${options.valueTypeName}, ${options.valueTypeName}) {
    return _insert(self.${options.checkpointFieldName}, key, value);
}

/**
 * @dev Returns the value in the oldest checkpoint with key greater or equal than the search key, or zero if there is none.
 */
function lowerLookup(${options.historyTypeName} storage self, ${options.keyTypeName} key) internal view returns (${options.valueTypeName}) {
    uint256 len = self.${options.checkpointFieldName}.length;
    uint256 pos = _lowerBinaryLookup(self.${options.checkpointFieldName}, key, 0, len);
    return pos == len ? 0 : _unsafeAccess(self.${options.checkpointFieldName}, pos).${options.valueFieldName};
}

/**
 * @dev Returns the value in the most recent checkpoint with key lower or equal than the search key.
 */
function upperLookup(${options.historyTypeName} storage self, ${options.keyTypeName} key) internal view returns (${options.valueTypeName}) {
    uint256 len = self.${options.checkpointFieldName}.length;
    uint256 pos = _upperBinaryLookup(self.${options.checkpointFieldName}, key, 0, len);
    return pos == 0 ? 0 : _unsafeAccess(self.${options.checkpointFieldName}, pos - 1).${options.valueFieldName};
}

/**
 * @dev Returns the value in the most recent checkpoint with key lower or equal than the search key.
 *
 * NOTE: This is a variant of {upperLookup} that is optimised to find "recent" checkpoint (checkpoints with high keys).
 */
function upperLookupRecent(${options.historyTypeName} storage self, ${options.keyTypeName} key) internal view returns (${options.valueTypeName}) {
    uint256 len = self.${options.checkpointFieldName}.length;

    uint256 low = 0;
    uint256 high = len;

    if (len > 5) {
        uint256 mid = len - Math.sqrt(len);
        if (key < _unsafeAccess(self.${options.checkpointFieldName}, mid)._key) {
            high = mid;
        } else {
            low = mid + 1;
        }
    }

    uint256 pos = _upperBinaryLookup(self.${options.checkpointFieldName}, key, low, high);

    return pos == 0 ? 0 : _unsafeAccess(self.${options.checkpointFieldName}, pos - 1).${options.valueFieldName};
}
`;

const legacyOperations = options => `\
/**
 * @dev Returns the value at a given block number. If a checkpoint is not available at that block, the closest one
 * before it is returned, or zero otherwise. Because the number returned corresponds to that at the end of the
 * block, the requested block number must be in the past, excluding the current block.
 */
function getAtBlock(${options.historyTypeName} storage self, uint256 blockNumber) internal view returns (uint256) {
    require(blockNumber < block.number, "Checkpoints: block not yet mined");
    uint32 key = SafeCast.toUint32(blockNumber);

    uint256 len = self.${options.checkpointFieldName}.length;
    uint256 pos = _upperBinaryLookup(self.${options.checkpointFieldName}, key, 0, len);
    return pos == 0 ? 0 : _unsafeAccess(self.${options.checkpointFieldName}, pos - 1).${options.valueFieldName};
}

/**
 * @dev Returns the value at a given block number. If a checkpoint is not available at that block, the closest one
 * before it is returned, or zero otherwise. Similar to {upperLookup} but optimized for the case when the searched
 * checkpoint is probably "recent", defined as being among the last sqrt(N) checkpoints where N is the number of
 * checkpoints.
 */
function getAtProbablyRecentBlock(${options.historyTypeName} storage self, uint256 blockNumber) internal view returns (uint256) {
    require(blockNumber < block.number, "Checkpoints: block not yet mined");
    uint32 key = SafeCast.toUint32(blockNumber);

    uint256 len = self.${options.checkpointFieldName}.length;

    uint256 low = 0;
    uint256 high = len;

    if (len > 5) {
        uint256 mid = len - Math.sqrt(len);
        if (key < _unsafeAccess(self.${options.checkpointFieldName}, mid)._blockNumber) {
            high = mid;
        } else {
            low = mid + 1;
        }
    }

    uint256 pos = _upperBinaryLookup(self.${options.checkpointFieldName}, key, low, high);

    return pos == 0 ? 0 : _unsafeAccess(self.${options.checkpointFieldName}, pos - 1).${options.valueFieldName};
}

/**
 * @dev Pushes a value onto a History so that it is stored as the checkpoint for the current block.
 *
 * Returns previous value and new value.
 */
function push(${options.historyTypeName} storage self, uint256 value) internal returns (uint256, uint256) {
    return _insert(self.${options.checkpointFieldName}, SafeCast.toUint32(block.number), SafeCast.toUint224(value));
}

/**
 * @dev Pushes a value onto a History, by updating the latest value using binary operation \`op\`. The new value will
 * be set to \`op(latest, delta)\`.
 *
 * Returns previous value and new value.
 */
function push(
    ${options.historyTypeName} storage self,
    function(uint256, uint256) view returns (uint256) op,
    uint256 delta
) internal returns (uint256, uint256) {
    return push(self, op(latest(self), delta));
}
`;

const common = options => `\
/**
 * @dev Returns the value in the most recent checkpoint, or zero if there are no checkpoints.
 */
function latest(${options.historyTypeName} storage self) internal view returns (${options.valueTypeName}) {
    uint256 pos = self.${options.checkpointFieldName}.length;
    return pos == 0 ? 0 : _unsafeAccess(self.${options.checkpointFieldName}, pos - 1).${options.valueFieldName};
}

/**
 * @dev Returns whether there is a checkpoint in the structure (i.e. it is not empty), and if so the key and value
 * in the most recent checkpoint.
 */
function latestCheckpoint(${options.historyTypeName} storage self)
    internal
    view
    returns (
        bool exists,
        ${options.keyTypeName} ${options.keyFieldName},
        ${options.valueTypeName} ${options.valueFieldName}
    )
{
    uint256 pos = self.${options.checkpointFieldName}.length;
    if (pos == 0) {
        return (false, 0, 0);
    } else {
        ${options.checkpointTypeName} memory ckpt = _unsafeAccess(self.${options.checkpointFieldName}, pos - 1);
        return (true, ckpt.${options.keyFieldName}, ckpt.${options.valueFieldName});
    }
}

/**
 * @dev Returns the number of checkpoint.
 */
function length(${options.historyTypeName} storage self) internal view returns (uint256) {
    return self.${options.checkpointFieldName}.length;
}

/**
 * @dev Pushes a (\`key\`, \`value\`) pair into an ordered list of checkpoints, either by inserting a new checkpoint,
 * or by updating the last one.
 */
function _insert(
    ${options.checkpointTypeName}[] storage self,
    ${options.keyTypeName} key,
    ${options.valueTypeName} value
) private returns (${options.valueTypeName}, ${options.valueTypeName}) {
    uint256 pos = self.length;

    if (pos > 0) {
        // Copying to memory is important here.
        ${options.checkpointTypeName} memory last = _unsafeAccess(self, pos - 1);

        // Checkpoint keys must be non-decreasing.
        require(last.${options.keyFieldName} <= key, "Checkpoint: decreasing keys");

        // Update or push new checkpoint
        if (last.${options.keyFieldName} == key) {
            _unsafeAccess(self, pos - 1).${options.valueFieldName} = value;
        } else {
            self.push(${options.checkpointTypeName}({${options.keyFieldName}: key, ${options.valueFieldName}: value}));
        }
        return (last.${options.valueFieldName}, value);
    } else {
        self.push(${options.checkpointTypeName}({${options.keyFieldName}: key, ${options.valueFieldName}: value}));
        return (0, value);
    }
}

/**
 * @dev Return the index of the oldest checkpoint whose key is greater than the search key, or \`high\` if there is none.
 * \`low\` and \`high\` define a section where to do the search, with inclusive \`low\` and exclusive \`high\`.
 *
 * WARNING: \`high\` should not be greater than the array's length.
 */
function _upperBinaryLookup(
    ${options.checkpointTypeName}[] storage self,
    ${options.keyTypeName} key,
    uint256 low,
    uint256 high
) private view returns (uint256) {
    while (low < high) {
        uint256 mid = Math.average(low, high);
        if (_unsafeAccess(self, mid).${options.keyFieldName} > key) {
            high = mid;
        } else {
            low = mid + 1;
        }
    }
    return high;
}

/**
 * @dev Return the index of the oldest checkpoint whose key is greater or equal than the search key, or \`high\` if there is none.
 * \`low\` and \`high\` define a section where to do the search, with inclusive \`low\` and exclusive \`high\`.
 *
 * WARNING: \`high\` should not be greater than the array's length.
 */
function _lowerBinaryLookup(
    ${options.checkpointTypeName}[] storage self,
    ${options.keyTypeName} key,
    uint256 low,
    uint256 high
) private view returns (uint256) {
    while (low < high) {
        uint256 mid = Math.average(low, high);
        if (_unsafeAccess(self, mid).${options.keyFieldName} < key) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }
    return high;
}

/**
 * @dev Access an element of the array without performing bounds check. The position is assumed to be within bounds.
 */
function _unsafeAccess(${options.checkpointTypeName}[] storage self, uint256 pos)
    private
    pure
    returns (${options.checkpointTypeName} storage result)
{
    assembly {
        mstore(0, self.slot)
        result.slot := add(keccak256(0, 0x20), pos)
    }
}
`;
 

// GENERATE
module.exports = format(
  header.trimEnd(),
  'library Checkpoints {',
  [
    // Legacy types & functions
    types(LEGACY_OPTS),
    legacyOperations(LEGACY_OPTS),
    common(LEGACY_OPTS),
    // New flavors
    ...OPTS.flatMap(options => [types(options), operations(options), common(options)]),
  ],
  '}',
);
