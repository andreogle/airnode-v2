import { Command } from 'commander';
import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bold, dim, reset } from '../colors';

// =============================================================================
// Command
// =============================================================================
export const address = new Command('address')
  .description('Derive and display the airnode address from AIRNODE_PRIVATE_KEY')
  .action(() => {
    const privateKey = process.env['AIRNODE_PRIVATE_KEY'] as Hex | undefined;
    if (!privateKey) {
      console.error('AIRNODE_PRIVATE_KEY environment variable is required');
      // eslint-disable-next-line unicorn/no-process-exit
      process.exit(1);
    }

    const account = privateKeyToAccount(privateKey);
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
