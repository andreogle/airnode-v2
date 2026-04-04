import { Command } from 'commander';
import type { Hex } from 'viem';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { bold, dim, reset } from '../colors';

// =============================================================================
// Helpers
// =============================================================================
function resolveAccount(): { readonly address: string } {
  const mnemonic = process.env['AIRNODE_MNEMONIC'];
  if (mnemonic) return mnemonicToAccount(mnemonic);

  const privateKey = process.env['AIRNODE_PRIVATE_KEY'] as Hex | undefined;
  if (privateKey) return privateKeyToAccount(privateKey);

  console.error('AIRNODE_PRIVATE_KEY or AIRNODE_MNEMONIC environment variable is required');
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1);
}

// =============================================================================
// Command
// =============================================================================
export const address = new Command('address')
  .description('Derive and display the airnode address from AIRNODE_PRIVATE_KEY or AIRNODE_MNEMONIC')
  .action(() => {
    const account = resolveAccount();
    const separator = dim + '─'.repeat(70) + reset;

    const lines = [
      ``,
      separator,
      `${bold}  Airnode Address${reset}`,
      separator,
      ``,
      `  ${dim}Address:${reset}`,
      `  ${bold}${account.address}${reset}`,
      ``,
      separator,
      ``,
    ];

    console.info(lines.join('\n'));
  });
