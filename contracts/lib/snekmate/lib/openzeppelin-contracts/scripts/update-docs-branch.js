const proc = require('node:child_process');
const read = cmd => proc.execSync(cmd, { encoding: 'utf8' }).trim();
const run = cmd => {
  proc.execSync(cmd, { stdio: 'inherit' });
};
const tryRead = cmd => {
  try {
    return read(cmd);
  } catch {
    return;
  }
};

const releaseBranchRegex = /^release-v(?<version>(?<major>\d+)\.(?<minor>\d+)(?:\.(?<patch>\d+))?)$/;

const currentBranch = read('git rev-parse --abbrev-ref HEAD');
const match = currentBranch.match(releaseBranchRegex);

if (!match) {
  console.error('Not currently on a release branch');
  process.exit(1);
}

const packageVersion = require('../package.json').version;

if (packageVersion.includes('-') && !packageVersion.includes('.0.0-')) {
  console.error('Refusing to update docs: non-major prerelease detected');
  process.exit(0);
}

const current = match.groups;
const docsBranch = `docs-v${current.major}.x`;

// Fetch remotes and find the docs branch if it exists
run('git fetch --all --no-tags');
const matchingDocsBranches = tryRead(`git rev-parse --glob='*/${docsBranch}'`);

if (matchingDocsBranches) {
  const [publishedReference, ...others] = new Set(matchingDocsBranches.split('\n'));
  if (others.length > 0) {
    console.error(
      `Found conflicting ${docsBranch} branches.\n` +
        'Either local branch is outdated or there are multiple matching remote branches.',
    );
    process.exit(1);
  }
  const publishedVersion = JSON.parse(read(`git show ${publishedReference}:package.json`)).version;
  const publishedMinor = publishedVersion.match(/\d+\.(?<minor>\d+)\.\d+/).groups.minor;
  if (current.minor < publishedMinor) {
    console.error('Refusing to update docs: newer version is published');
    process.exit(0);
  }

  run('git checkout --quiet --detach');
  run(`git reset --soft ${publishedReference}`);
  run(`git checkout ${docsBranch}`);
} else {
  // Create the branch
  run(`git checkout --orphan ${docsBranch}`);
}

run('npm run prepare-docs');
run('git add -f docs'); // --force needed because generated docs files are gitignored
run('git commit -m "Update docs"');
run(`git checkout ${currentBranch}`);
