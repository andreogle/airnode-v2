#!/usr/bin/env node
const { spawnSync, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const normalizeNewlines = s => s.replaceAll(/\n(\n\s*)+/g, '\n\n');

const hexNoPrefix = x => x.toString(16).replace(/^0[xX]/, '');

const readSync = sourcePath => 
  fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, { encoding: 'utf8', flag: 'r' }) : '';

const runCommandSync = (command, arguments_) => {
  const result = spawnSync(command, arguments_, { encoding:'utf-8' });
  if (result.error) {
    console.error('Error executing command:', result.error.message);
  } else {
    return result.stdout;
  }
};

const hasAnyPathSequence = (sourcePath, paths) => {
  const d = '\0', norm = p => d + path.normalize(p).split(path.sep).join(d) + d;
  return paths.some(p => norm(sourcePath).includes(norm(p)));
};

const genSectionRegex = name =>
  new RegExp(
    String.raw`(\s*\/\*\S+?\*\/\s*\/\*\s+` +
    name.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`) +
    String.raw`\s+\*\/\s*\/\*\S+?\*\/)[\s\S]+?(\/\*\S+?\*\/)`
  );

const writeSync = (sourcePath, source) => {
  const dir = path.dirname(sourcePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(sourcePath, source);
};

const writeAndFmtSync = (sourcePath, source) => {
  writeSync(sourcePath, source);
  runCommandSync('forge', ['fmt', sourcePath]);
};

const walkSync = (dir, callback) => {
  for (const file of fs.readdirSync(dir)) {
    const sourcePath = path.join(dir, file);
    const stats = fs.statSync(sourcePath);
    stats.isDirectory() ? walkSync(sourcePath, callback) : stats.isFile() && callback(sourcePath, stats);
  }
};

const forEachWalkSync = (directories, callback) => {
  for (const dir of directories) { walkSync(dir, callback); }
};

const readSolWithLineLengthSync = (sourcePath, lineLength) => {
  const tmpDir = path.join(__dirname, 'out', (`__t${  Math.random()}`).replaceAll('.', '_'));
  writeSync(
    path.resolve(path.join(tmpDir, 'foundry.toml')),
    fs.readFileSync(path.resolve('foundry.toml'), 'utf8')
    .replaceAll(/line_length\s*=\s*\d+/g, `line_length = ${  lineLength}`)
  );
  fs.copyFileSync(sourcePath, path.join(tmpDir, 'x.sol'));
  execSync('forge fmt x.sol', { cwd: tmpDir, stdio: 'inherit' });
  const content = fs.readFileSync(path.join(tmpDir, 'x.sol'), 'utf8');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  return content;
};

module.exports = {
  genSectionRegex,
  hexNoPrefix,
  hasAnyPathSequence,
  normalizeNewlines,
  readSync,
  runCommandSync,
  writeSync,
  writeAndFmtSync,
  walkSync,
  forEachWalkSync,
  readSolWithLineLengthSync
};
