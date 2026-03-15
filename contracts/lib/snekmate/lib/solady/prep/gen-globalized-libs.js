#!/usr/bin/env node
const { hasAnyPathSequence, readSync, writeSync, forEachWalkSync } = require('./common.js');

async function main() {
  const pathSequencesToIgnore = ['g', 'utils/ext/ithaca'];

  forEachWalkSync(['src/utils'], sourcePath => {
    if (!/\.sol$/i.test(sourcePath)) return;
    if (hasAnyPathSequence(sourcePath, pathSequencesToIgnore)) return;

    let source = readSync(sourcePath);
    const libraryStartMatch = source.match(/library\s+([A-Za-z0-9]+)\s+\{/);
    if (!libraryStartMatch) return;
    
    let structsSource = '', usings = [];
    source = source.replace(
      /\s*\/\*\S+?\*\/\s*\/\*\s+STRUCTS?\s+\*\/\s*\/\*\S+?\*\/([\s\S]+?struct\s+[A-Za-z0-9]+\s+\{[\s\S]+?\})+/, 
      m => (structsSource = m, '')
    );

    for (let m, r = /struct\s+([A-Za-z0-9]+)\s+\{/g; m = r.exec(structsSource); ) {
      usings.push(`using ${  libraryStartMatch[1]  } for ${  m[1]  } global;`);
    }
    if (usings.length === 0 || structsSource === '') return;

    const dstPath = sourcePath.replace(/([A-Za-z0-9]+\.sol)/, 'g/$1');
    console.log(dstPath);
    writeSync(
      dstPath, 
      source.replace(
        /pragma\s+solidity\s+\^0\.8\.\d+;/, 
        [
          'pragma solidity ^0.8.13;',
          '// This file is auto-generated.',
          structsSource.replaceAll('\n    ', '\n').replaceAll(/^\s*\n+|\n+\s*$/g, ''),
          usings.join('\n').replaceAll(/^\s*\n+|\n+\s*$/g, '')
        ].join('\n\n')
      )
      .replace(/(https\:\/\/\S+?\/solady\/\S+?\/)([A-Za-z0-9]+\.sol)/, '$1g/$2')
      .replaceAll(/(import\s[\s\S]*?["'])\.\/([\s\S]+?["'])/g, '$1../$2')
      .replace(/(library\s+([A-Za-z0-9]+)\s+\{\n)\n*/, '$1')
    );
  });
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
