const fs = require('node:fs');
const { TASK_COMPILE_GET_REMAPPINGS } = require('hardhat/builtin-tasks/task-names');
const { task } = require('hardhat/config');

task(TASK_COMPILE_GET_REMAPPINGS).setAction((taskArguments, environment, runSuper) =>
  runSuper().then(remappings =>
    Object.assign(
      remappings,
      Object.fromEntries(
        fs
          .readFileSync('remappings.txt', 'utf8')
          .split('\n')
          .filter(Boolean)
          .map(line => line.trim().split('=')),
      ),
    ),
  ),
);
