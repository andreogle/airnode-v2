import { describe, expect, test } from 'bun:test';

// =============================================================================
// CLI identity command — integration-level smoke tests
// =============================================================================
describe('identity CLI', () => {
  test('show command requires AIRNODE_PRIVATE_KEY', async () => {
    const { AIRNODE_PRIVATE_KEY: _, ...envWithoutKey } = process.env;
    // Use --env-file /dev/null to prevent Bun from auto-loading .env
    const proc = Bun.spawn(
      ['bun', '--env-file', '/dev/null', 'src/cli/index.ts', 'identity', 'show', '-d', 'example.com'],
      { env: envWithoutKey, stdout: 'pipe', stderr: 'pipe' }
    );

    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(1);
    expect(stderr).toContain('AIRNODE_PRIVATE_KEY');
  });

  test('verify command rejects invalid address', async () => {
    const proc = Bun.spawn(
      ['bun', 'src/cli/index.ts', 'identity', 'verify', '-a', 'not-an-address', '-d', 'example.com'],
      { stdout: 'pipe', stderr: 'pipe' }
    );

    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Invalid address');
  });
});
