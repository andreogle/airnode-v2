const format = require('../format-lines');
const { OPTS } = require('./Checkpoints.opts');

// TEMPLATE
const header = `\
pragma solidity ^0.8.20;

import {Math} from "../math/Math.sol";

/**
 * @dev This library defines the \`Trace*\` struct, for checkpointing values as they change at different points in
 * time, and later looking up past values by block number. See {Votes} as an example.
 *
 * To create a history of checkpoints define a variable type \`Checkpoints.Trace*\` in your contract, and store a new
 * checkpoint for the current transaction block using the {push} function.
 */
`;

const errors = `\
    /**
     * @dev A value was attempted to be inserted on a past checkpoint.
     */
    error CheckpointUnorderedInsertion();
`;

const template = options => `\
struct ${options.historyTypeName} {
    ${options.checkpointTypeName}[] ${options.checkpointFieldName};
}

struct ${options.checkpointTypeName} {
    ${options.keyTypeName} ${options.keyFieldName};
    ${options.valueTypeName} ${options.valueFieldName};
}

/**
 * @dev Pushes a (\`key\`, \`value\`) pair into a ${options.historyTypeName} so that it is stored as the checkpoint.
 *
 * Returns previous value and new value.
 * 
 * IMPORTANT: Never accept \`key\` as a user input, since an arbitrary \`type(${options.keyTypeName}).max\` key set will disable the
 * library.
 */
function push(
    ${options.historyTypeName} storage self,
    ${options.keyTypeName} key,
    ${options.valueTypeName} value
) internal returns (${options.valueTypeName}, ${options.valueTypeName}) {
    return _insert(self.${options.checkpointFieldName}, key, value);
}

/**
 * @dev Returns the value in the first (oldest) checkpoint with key greater or equal than the search key, or zero if
 * there is none.
 */
function lowerLookup(${options.historyTypeName} storage self, ${options.keyTypeName} key) internal view returns (${options.valueTypeName}) {
    uint256 len = self.${options.checkpointFieldName}.length;
    uint256 pos = _lowerBinaryLookup(self.${options.checkpointFieldName}, key, 0, len);
    return pos == len ? 0 : _unsafeAccess(self.${options.checkpointFieldName}, pos).${options.valueFieldName};
}

/**
 * @dev Returns the value in the last (most recent) checkpoint with key lower or equal than the search key, or zero
 * if there is none.
 */
function upperLookup(${options.historyTypeName} storage self, ${options.keyTypeName} key) internal view returns (${options.valueTypeName}) {
    uint256 len = self.${options.checkpointFieldName}.length;
    uint256 pos = _upperBinaryLookup(self.${options.checkpointFieldName}, key, 0, len);
    return pos == 0 ? 0 : _unsafeAccess(self.${options.checkpointFieldName}, pos - 1).${options.valueFieldName};
}

/**
 * @dev Returns the value in the last (most recent) checkpoint with key lower or equal than the search key, or zero
 * if there is none.
 *
 * NOTE: This is a variant of {upperLookup} that is optimised to find "recent" checkpoint (checkpoints with high
 * keys).
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
        ${options.checkpointTypeName} storage ckpt = _unsafeAccess(self.${options.checkpointFieldName}, pos - 1);
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
 * @dev Returns checkpoint at given position.
 */
function at(${options.historyTypeName} storage self, uint32 pos) internal view returns (${options.checkpointTypeName} memory) {
    return self.${options.checkpointFieldName}[pos];
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
        ${options.checkpointTypeName} storage last = _unsafeAccess(self, pos - 1);
        ${options.keyTypeName} lastKey = last.${options.keyFieldName};
        ${options.valueTypeName} lastValue = last.${options.valueFieldName};

        // Checkpoint keys must be non-decreasing.
        if (lastKey > key) {
            revert CheckpointUnorderedInsertion();
        }

        // Update or push new checkpoint
        if (lastKey == key) {
            _unsafeAccess(self, pos - 1).${options.valueFieldName} = value;
        } else {
            self.push(${options.checkpointTypeName}({${options.keyFieldName}: key, ${options.valueFieldName}: value}));
        }
        return (lastValue, value);
    } else {
        self.push(${options.checkpointTypeName}({${options.keyFieldName}: key, ${options.valueFieldName}: value}));
        return (0, value);
    }
}

/**
 * @dev Return the index of the last (most recent) checkpoint with key lower or equal than the search key, or \`high\`
 * if there is none. \`low\` and \`high\` define a section where to do the search, with inclusive \`low\` and exclusive
 * \`high\`.
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
 * @dev Return the index of the first (oldest) checkpoint with key is greater or equal than the search key, or
 * \`high\` if there is none. \`low\` and \`high\` define a section where to do the search, with inclusive \`low\` and
 * exclusive \`high\`.
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
  errors,
  OPTS.flatMap(options => template(options)),
  '}',
);
