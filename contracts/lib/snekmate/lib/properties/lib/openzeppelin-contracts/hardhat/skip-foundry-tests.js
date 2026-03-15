const { TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS } = require('hardhat/builtin-tasks/task-names');
const { subtask } = require('hardhat/config');

subtask(TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS).setAction(async (_, __, runSuper) =>
  (await runSuper()).filter(path => !path.endsWith('.t.sol')),
);
