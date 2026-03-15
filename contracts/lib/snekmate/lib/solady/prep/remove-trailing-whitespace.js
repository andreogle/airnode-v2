#!/usr/bin/env node
const { readSync, writeSync, forEachWalkSync } = require('./common.js');

async function main() {
  forEachWalkSync(['src'], sourcePath => {
    if (!/\.sol$/i.test(sourcePath)) return;
    const source = readSync(sourcePath);
    const cleanedSource = source.split('\n').map(l => l.replace(/\s+$/, '')).join('\n');
    if (source !== cleanedSource) writeSync(sourcePath, source);
  });
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
