#!/usr/bin/env node
const { execSync } = require('node:child_process');
const { readSync, forEachWalkSync } = require('./common.js');

async function main() {
  const getLastModifiedGitTimestamp = (filePath) => {
    try {
      const output = execSync(`git log -1 --format=%ct -- ${filePath}`, { encoding: 'utf-8' });
      return Math.trunc(output.trim());
    } catch {
      return null;
    }
  };

  const eofBannedOpcodes = [
    'codesize', 'codecopy',
    'extcodesize', 'extcodecopy', 'extcodehash',
    'jump', 'pc',
    'gas', 'gaslimit', 'gasprice',
    'create', 'create2',
    'call', 'staticcall', 'delegatecall',
    'selfdestruct', 'callcode'
  ];

  const specialPatterns = [
    {name: 'returndatacopyOGG', reStr: String.raw`returndatacopy\([\s\S]*?,[\s\S]*?returndatasize`}
  ]

  const flattenedPathsAndScores = [];

  forEachWalkSync(['src'], sourcePath => {
    if (!/\.sol$/i.test(sourcePath) || /\/(g|legacy)\//.test(sourcePath)) return;

    const source = readSync(sourcePath);
    const numberMatches = reString => (source.match(new RegExp(reString, 'g')) || []).length;
    let totalScore = 0;
    const scores = {};
    let redundantGasCount = 0;
    for (const opcode of eofBannedOpcodes) {
      const score = numberMatches(String.raw`[^a-zA-z]${  opcode  }\(`);
      if (opcode.endsWith('call')) {
        redundantGasCount += numberMatches(String.raw`[^a-zA-z]${  opcode  }\([\S\s]*?gas\s*?\(`);
      }
      totalScore += score;
      scores[opcode] = score;
    }
    for (const c of specialPatterns) {
      const score = numberMatches(c.reStr);
      totalScore += score;
      scores[c.name] = score;
    }
    if (redundantGasCount) scores['gas'] -= redundantGasCount;
    for (const key in scores) if (scores[key] === 0) delete scores[key];
    const lastModifiedGitTimestamp = getLastModifiedGitTimestamp(sourcePath);
    flattenedPathsAndScores.push({srcPath: sourcePath, scores, totalScore, lastModifiedGitTimestamp});
  });

  flattenedPathsAndScores.sort((a, b) => a.totalScore - b.totalScore);
  for (const x of flattenedPathsAndScores) {
    if (x.totalScore === 0) delete x.scores;
    delete x.totalScore;
  }
  console.log(JSON.stringify(flattenedPathsAndScores, null, 4));
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
