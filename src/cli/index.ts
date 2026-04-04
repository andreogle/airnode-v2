import { Command } from 'commander';
import { VERSION } from '../version';
import { address } from './commands/address';
import { config } from './commands/config';
import { generateMnemonicCommand } from './commands/generate-mnemonic';
import { identity } from './commands/identity';
import { start } from './commands/start';

const program = new Command().name('airnode').description('Airnode - First-party oracle node').version(VERSION);

program.addCommand(address);
program.addCommand(config);
program.addCommand(generateMnemonicCommand);
program.addCommand(identity);
program.addCommand(start);

program.parse();
