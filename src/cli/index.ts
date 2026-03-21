import { Command } from 'commander';
import { VERSION } from '../version';
import { address } from './commands/address';
import { cacheServer } from './commands/cache-server';
import { config } from './commands/config';
import { generateKey } from './commands/generate-key';
import { identity } from './commands/identity';
import { start } from './commands/start';

const program = new Command().name('airnode').description('Airnode - First-party oracle node').version(VERSION);

program.addCommand(address);
program.addCommand(cacheServer);
program.addCommand(config);
program.addCommand(generateKey);
program.addCommand(identity);
program.addCommand(start);

program.parse();
