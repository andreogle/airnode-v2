import { describe, expect, test } from 'bun:test';

// =============================================================================
// CLI `address` command — spawn-based smoke tests
//
// The address-derivation logic is unit-tested in src/sign.test.ts
// (`accountFromEnv`); these cover the CLI wiring: key/mnemonic in, address out,
// clear error + exit 1 when the key material is missing or malformed.
// =============================================================================

// The anvil account #0 — its private key and mnemonic both derive this address.
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_MNEMONIC = 'test test test test test test test test test test test junk';
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

async function runAddress(
  env: Record<string, string | undefined>
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const { AIRNODE_PRIVATE_KEY: _k, AIRNODE_MNEMONIC: _m, ...base } = process.env;
  const proc = Bun.spawn(['bun', '--env-file', '/dev/null', 'src/cli/index.ts', 'address'], {
    env: { ...base, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

describe('address CLI', () => {
  test('derives the address from AIRNODE_PRIVATE_KEY', async () => {
    const { exitCode, stdout } = await runAddress({ AIRNODE_PRIVATE_KEY: TEST_PRIVATE_KEY });
    expect(exitCode).toBe(0);
    expect(stdout).toContain(TEST_ADDRESS);
  });

  test('derives the address from AIRNODE_MNEMONIC', async () => {
    const { exitCode, stdout } = await runAddress({ AIRNODE_MNEMONIC: TEST_MNEMONIC });
    expect(exitCode).toBe(0);
    expect(stdout).toContain(TEST_ADDRESS);
  });

  test('exits 1 with a clear error when neither variable is set', async () => {
    const { exitCode, stderr } = await runAddress({});
    expect(exitCode).toBe(1);
    expect(stderr).toContain('AIRNODE_PRIVATE_KEY or AIRNODE_MNEMONIC environment variable is required');
  });

  test('exits 1 with a clear error on a malformed private key', async () => {
    const { exitCode, stderr } = await runAddress({ AIRNODE_PRIVATE_KEY: '0xnothex' });
    expect(exitCode).toBe(1);
    expect(stderr).toContain('AIRNODE_PRIVATE_KEY must be a 0x-prefixed 32-byte hex string');
  });
});
