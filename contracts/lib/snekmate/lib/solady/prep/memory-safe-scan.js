#!/usr/bin/env node
const { readSync, forEachWalkSync, hasAnyPathSequence } = require('./common.js');

async function main() {
  const pathSequencesToIgnore = ['g', 'legacy'];

  const loggedSourcePaths = [];
  forEachWalkSync(['src'], sourcePath => {
    if (!/\.sol$/i.test(sourcePath)) return;
    if (hasAnyPathSequence(sourcePath, pathSequencesToIgnore)) return;

    const source = readSync(sourcePath);
    const assemblyTagRe = /(\/\/\/\s*?@solidity\s*?memory-safe-assembly\s+?)?assembly\s*?(\(.*?\))?\{/gm;
    for (let m = null; (m = assemblyTagRe.exec(source)) !== null; ) {
      if (!(m[0]).includes('memory-safe')) {
        if (!loggedSourcePaths.includes(sourcePath)) {
          loggedSourcePaths.push(sourcePath);
          console.log(`${sourcePath  }:`);
        }
        console.log('  line:', source.slice(0, m.index).split(/\n/).length);
      }
    }
  });
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
