import { Command } from 'commander';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { bold, dim, red, reset, yellow } from '../colors';

// =============================================================================
// Command
// =============================================================================
export const generateKey = new Command('generate-key')
  .description('Generate a new private key for an Airnode operator')
  .action(() => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    const separator = dim + '─'.repeat(70) + reset;

    const lines = [
      ``,
      separator,
      `${bold}  Airnode Private Key Generated${reset}`,
      separator,
      ``,
      `  ${dim}Private Key:${reset}`,
      `  ${bold}${privateKey}${reset}`,
      ``,
      `  ${dim}Address:${reset}`,
      `  ${bold}${account.address}${reset}`,
      ``,
      separator,
      `${yellow}${bold}  ⚠  WARNINGS${reset}`,
      separator,
      ``,
      `${yellow}  This private key controls your Airnode's identity.${reset}`,
      `${yellow}  Whoever holds this key can:${reset}`,
      ``,
      `  ${bold}  •${reset} Sign API responses on behalf of your Airnode`,
      `  ${bold}  •${reset} Submit verified data to callback contracts (AirnodeVerifier)`,
      ``,
      `${yellow}  Store this key securely. Do not share it. Do not commit it to git.${reset}`,
      `${yellow}  Set it as AIRNODE_PRIVATE_KEY in your environment or .env file.${reset}`,
      ``,
      `${red}  If lost, your Airnode identity is unrecoverable.${reset}`,
      ``,
      separator,
      ``,
    ];

    console.info(lines.join('\n'));
  });
