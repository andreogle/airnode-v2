import { validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { describe, expect, test } from 'bun:test';
import { mnemonicToAccount } from 'viem/accounts';

// =============================================================================
// CLI `generate-mnemonic` command — spawn-based smoke test
// =============================================================================
describe('generate-mnemonic CLI', () => {
  test('prints a valid 12-word mnemonic and its derived address', async () => {
    const proc = Bun.spawn(['bun', 'src/cli/index.ts', 'generate-mnemonic'], { stdout: 'pipe', stderr: 'pipe' });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);

    // The mnemonic is the only line that is exactly 12 lowercase words.
    const mnemonic = stdout
      .split('\n')
      .map((line) => line.trim())
      .find((line) => /^([a-z]+ ){11}[a-z]+$/.test(line));
    expect(mnemonic).toBeDefined();
    if (!mnemonic) return;
    expect(validateMnemonic(mnemonic, wordlist)).toBe(true);

    // The derived address must also appear in the output.
    expect(stdout).toContain(mnemonicToAccount(mnemonic).address);
  });
});
