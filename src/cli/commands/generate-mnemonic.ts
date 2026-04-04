import { wordlist as english } from '@scure/bip39/wordlists/english';
import { Command } from 'commander';
import { generateMnemonic, mnemonicToAccount } from 'viem/accounts';
import { bold, dim, red, reset, yellow } from '../colors';

// =============================================================================
// Command
// =============================================================================
export const generateMnemonicCommand = new Command('generate-mnemonic')
  .description('Generate a new mnemonic and derive the Airnode address')
  .action(() => {
    const mnemonic = generateMnemonic(english);
    const account = mnemonicToAccount(mnemonic);

    const separator = dim + '─'.repeat(70) + reset;

    const lines = [
      ``,
      separator,
      `${bold}  Airnode Mnemonic Generated${reset}`,
      separator,
      ``,
      `  ${dim}Mnemonic:${reset}`,
      `  ${bold}${mnemonic}${reset}`,
      ``,
      `  ${dim}Address:${reset}`,
      `  ${bold}${account.address}${reset}`,
      ``,
      separator,
      `${yellow}${bold}  ⚠  WARNINGS${reset}`,
      separator,
      ``,
      `${yellow}  This mnemonic controls your Airnode's identity.${reset}`,
      `${yellow}  Whoever holds this mnemonic can:${reset}`,
      ``,
      `  ${bold}  •${reset} Sign API responses on behalf of your Airnode`,
      `  ${bold}  •${reset} Submit verified data to callback contracts (AirnodeVerifier)`,
      ``,
      `${yellow}  Write down this mnemonic and store it securely.${reset}`,
      `${yellow}  Do not share it. Do not commit it to git.${reset}`,
      `${yellow}  Set it as AIRNODE_MNEMONIC in your environment or .env file.${reset}`,
      ``,
      `${red}  If lost, your Airnode identity is unrecoverable.${reset}`,
      ``,
      separator,
      ``,
    ];

    console.info(lines.join('\n'));
  });
