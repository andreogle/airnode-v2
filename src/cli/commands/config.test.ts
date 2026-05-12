import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'bun:test';

// =============================================================================
// `config validate` CLI command — integration-level smoke tests
//
// The underlying validateConfig() logic is exercised in config/validate.test.ts;
// these tests cover the CLI wiring: a valid config prints a success line and
// exits 0; an invalid one prints the formatted errors and exits 1.
// =============================================================================
describe('config CLI — validate', () => {
  const badConfigPath = path.join(tmpdir(), `airnode-bad-config-${String(process.pid)}.yaml`);

  afterAll(async () => {
    await rm(badConfigPath, { force: true });
  });

  test('exits 0 and reports the config is valid', async () => {
    const proc = Bun.spawn(
      ['bun', 'src/cli/index.ts', 'config', 'validate', '-c', 'examples/configs/minimal/config.yaml'],
      { stdout: 'pipe', stderr: 'pipe' }
    );

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Config is valid');
    expect(stdout).toContain('1 API(s)');
  });

  test('exits 1 and prints the validation errors on an invalid config', async () => {
    await Bun.write(badConfigPath, 'version: "1.0"\nserver:\n  port: -1\nsettings:\n  proof: none\napis: []\n');

    const proc = Bun.spawn(['bun', 'src/cli/index.ts', 'config', 'validate', '-c', badConfigPath], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Validation failed');
    // Both schema errors should be surfaced.
    expect(stderr).toContain('server.port');
    expect(stderr).toContain('apis');
  });
});
