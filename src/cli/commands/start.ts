import path from 'node:path';
import { Command } from 'commander';
import type { Hex } from 'viem';
import { createAsyncRequestStore } from '../../async';
import { createCache } from '../../cache';
import { loadEnvFile } from '../../config/env';
import { parseConfig } from '../../config/parser';
import { buildEndpointMap } from '../../endpoint';
import { logger } from '../../logger';
import { handleEndpointRequest } from '../../pipeline';
import { loadPlugins } from '../../plugins';
import { createServer } from '../../server';
import { createAirnodeAccount, createAirnodeAccountFromMnemonic } from '../../sign';
import { VERSION } from '../../version';
import { printBanner } from '../banner';

const DEFAULT_CONFIG_PATH = 'config.yaml';
const DEFAULT_ENV_PATH = '.env';

interface RunOptions {
  readonly config: string;
  readonly env: string;
}

export const start = new Command('start')
  .description('Start the Airnode HTTP server')
  .option('-c, --config <path>', 'Path to config file', DEFAULT_CONFIG_PATH)
  .option('-e, --env <path>', 'Path to .env file', DEFAULT_ENV_PATH)
  .action(async (options: RunOptions) => {
    const configPath = path.resolve(options.config);
    const envPath = path.resolve(options.env);

    await loadEnvFile(envPath);

    const mnemonic = process.env['AIRNODE_MNEMONIC'];
    const privateKey = process.env['AIRNODE_PRIVATE_KEY'] as Hex | undefined;
    if (!privateKey && !mnemonic) {
      logger.error('AIRNODE_PRIVATE_KEY or AIRNODE_MNEMONIC environment variable is required');
      // eslint-disable-next-line unicorn/no-process-exit
      process.exit(1);
    }

    // Mnemonic takes precedence if both are set
    const account = mnemonic ? createAirnodeAccountFromMnemonic(mnemonic) : createAirnodeAccount(privateKey as Hex);

    const raw = await Bun.file(configPath).text();
    const config = parseConfig(raw);
    const endpointMap = buildEndpointMap(config);
    const plugins = await loadPlugins(config.settings.plugins, path.dirname(configPath));

    printBanner({
      address: account.address,
      version: VERSION,
      host: config.server.host,
      port: config.server.port,
      endpoints: endpointMap.size,
    });

    logger.info(`Config loaded: ${String(config.apis.length)} API(s), ${String(endpointMap.size)} endpoint(s)`);

    const cache = createCache();
    const asyncStore = createAsyncRequestStore();
    const server = createServer({
      config,
      account,
      airnode: account.address,
      endpointMap,
      plugins,
      cache,
      asyncStore,
      handleRequest: handleEndpointRequest,
    });

    const shutdown = (): void => {
      server.stop();
      cache.stop();
      asyncStore.stop();
      // eslint-disable-next-line unicorn/no-process-exit
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
