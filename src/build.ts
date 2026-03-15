import pkg from '../package.json';

const args = Bun.argv.slice(2);

const result = Bun.spawnSync([
  'bun',
  'build',
  'src/cli/index.ts',
  '--compile',
  '--minify',
  `--define`,
  `globalThis.__AIRNODE_VERSION__=${JSON.stringify(pkg.version)}`,
  ...args,
]);

process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exit(result.exitCode); // eslint-disable-line unicorn/no-process-exit
