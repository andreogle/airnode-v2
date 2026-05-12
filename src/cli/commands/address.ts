import { Command } from 'commander';
import type { PrivateKeyAccount } from 'viem/accounts';
import { accountFromEnv } from '../../sign';
import { bold, dim, reset } from '../colors';

// =============================================================================
// Helpers
// =============================================================================
function resolveAccount(): PrivateKeyAccount {
  const resolved = accountFromEnv();
  if (resolved.success) return resolved.account;

  console.error(resolved.error);
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
