/**
 * Run integration test files sequentially. Each file gets its own bun test
 * process so test files don't share mock API state or caches.
 *
 * The mock API server starts once here. Each test file boots its own Airnode
 * server on a random port pointing at the shared mock.
 */
import { Glob } from 'bun';
import { startMockApi } from './mock-api';

const mock = startMockApi();
console.info(`Mock API server at http://127.0.0.1:${String(mock.port)}`);

// =============================================================================
// Run each test file in its own process
// =============================================================================
const glob = new Glob('integration/scenarios/s*.test.ts');
const files = [...glob.scanSync('.')].toSorted();

// eslint-disable-next-line functional/no-let
let failed = 0;

// eslint-disable-next-line functional/no-loop-statements
for (const file of files) {
  mock.reset();

  const proc = Bun.spawn(['bun', 'test', '--no-coverage', `./${file}`], {
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env, MOCK_API_PORT: String(mock.port) },
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    failed++;
  }
}

mock.stop();

if (failed > 0) {
  console.error(`\n${String(failed)} test file(s) failed`);
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1);
}

console.info(`\nAll ${String(files.length)} test files passed`);
