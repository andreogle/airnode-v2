import { describe, expect, test } from 'bun:test';

// =============================================================================
// CLI `start` command — early-exit smoke test
//
// `start` boots a long-lived HTTP server, so we only exercise the path that
// exits before that: missing key material. (Config-validation failures are
// covered by config.test.ts via `airnode config validate`.)
// =============================================================================
describe('start CLI', () => {
  test('exits 1 with a clear error when no key material is configured', async () => {
    const { AIRNODE_PRIVATE_KEY: _k, AIRNODE_MNEMONIC: _m, ...env } = process.env;
    // `bun --env-file /dev/null` stops Bun from auto-loading a local `.env`;
    // `start -e /dev/null` makes the command's own loadEnvFile a no-op too.
    const proc = Bun.spawn(['bun', '--env-file', '/dev/null', 'src/cli/index.ts', 'start', '-e', '/dev/null'], {
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(1);
    expect(stderr).toContain('AIRNODE_PRIVATE_KEY or AIRNODE_MNEMONIC environment variable is required');
  });
});
