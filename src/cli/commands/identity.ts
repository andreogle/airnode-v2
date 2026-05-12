import { go, goSync } from '@api3/promise-utils';
import { Command } from 'commander';
import type { Hex } from 'viem';
import { getAddress } from 'viem';
import { buildTxtRecordHost, verifyIdentity } from '../../identity';
import { accountFromEnv } from '../../sign';
import { bold, dim, green, red, reset } from '../colors';

// =============================================================================
// show subcommand
// =============================================================================
interface ShowOptions {
  readonly domain: string;
  readonly chainId: string;
}

const show = new Command('show')
  .description('Show the DNS TXT record to set for identity verification')
  .requiredOption('-d, --domain <domain>', 'Domain name (e.g., api.coingecko.com)')
  .option('--chain-id <id>', 'Chain ID for the TXT record', '1')
  .action((options: ShowOptions) => {
    const resolved = accountFromEnv();
    if (!resolved.success) {
      console.error(resolved.error);
      // eslint-disable-next-line unicorn/no-process-exit
      process.exit(1);
    }

    const account = resolved.account;
    const chainId = Number(options.chainId);
    const host = buildTxtRecordHost(options.domain, chainId);
    const separator = dim + '─'.repeat(70) + reset;

    const lines = [
      ``,
      separator,
      `${bold}  Airnode Identity${reset}`,
      separator,
      ``,
      `  ${dim}Address${reset}    ${account.address}`,
      `  ${dim}Domain${reset}     ${options.domain}`,
      ``,
      `  Set this DNS TXT record:`,
      ``,
      `  ${dim}Host${reset}     ${bold}${host}${reset}`,
      `  ${dim}Value${reset}    ${bold}${account.address}${reset}`,
      ``,
      separator,
      ``,
    ];

    console.info(lines.join('\n'));
  });

// =============================================================================
// verify subcommand
// =============================================================================
interface VerifyOptions {
  readonly address: readonly string[];
  readonly domain: string;
  readonly chainId: string;
}

function parseAddresses(raw: readonly string[]): readonly string[] {
  return raw.flatMap((entry) =>
    entry
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean)
  );
}

function checksumAll(raw: readonly string[]): readonly string[] | undefined {
  const results = raw.map((addr) => goSync(() => getAddress(addr as Hex)));
  const failed = raw.filter((_, i) => !results[i]?.success);

  if (failed.length > 0) {
    console.error(`  Invalid address(es): ${failed.join(', ')}`);
    return undefined;
  }

  return results.map((r) => (r.success ? r.data : ''));
}

const verify = new Command('verify')
  .description('Verify that a domain has set the correct DNS TXT record for airnode address(es)')
  .requiredOption('-a, --address <address...>', 'Airnode address(es) to verify (repeatable, comma-separated)')
  .requiredOption('-d, --domain <domain>', 'Domain name to check')
  .option('--chain-id <id>', 'Chain ID for the TXT record', '1')
  .action(async (options: VerifyOptions) => {
    const chainId = Number(options.chainId);
    const parsed = parseAddresses(options.address);

    if (parsed.length === 0) {
      console.error('  No addresses provided');
      // eslint-disable-next-line unicorn/no-process-exit
      process.exit(1);
    }

    const checksummed = checksumAll(parsed);
    if (!checksummed) {
      // eslint-disable-next-line unicorn/no-process-exit
      process.exit(1);
    }

    const separator = dim + '─'.repeat(70) + reset;
    const host = buildTxtRecordHost(options.domain, chainId);

    console.info(`\n  Querying DNS TXT record at ${dim}${host}${reset}\n`);

    const goVerify = await go(() => verifyIdentity(checksummed, options.domain, chainId));
    if (!goVerify.success) {
      console.error(`  DNS query failed: ${goVerify.error.message}`);
      // eslint-disable-next-line unicorn/no-process-exit
      process.exit(1);
    }

    const results = goVerify.data;
    const allVerified = results.every((r) => r.verified);

    console.info(separator);

    if (allVerified) {
      console.info(`  ${green}${bold}Identity verified${reset}`);
    }
    if (!allVerified) {
      console.info(`  ${red}${bold}Identity NOT verified${reset}`);
    }

    // eslint-disable-next-line functional/no-loop-statements
    for (const result of results) {
      const status = result.verified ? `${green}verified${reset}` : `${red}NOT found${reset}`;
      console.info(`  ${dim}${result.address}${reset}  ${status}`);
    }

    console.info(`  ${dim}Domain${reset}   ${options.domain}`);
    console.info(separator);

    if (!allVerified) {
      // eslint-disable-next-line unicorn/no-process-exit
      process.exit(1);
    }
  });

// =============================================================================
// Parent command
// =============================================================================
export const identity = new Command('identity').description('DNS-based identity verification (ERC-7529)');

identity.addCommand(show);
identity.addCommand(verify);
