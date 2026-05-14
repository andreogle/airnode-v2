import path from 'node:path';
import { Command } from 'commander';
import { createAsyncRequestStore } from '../../async';
import { createCache } from '../../cache';
import { loadEnvFile } from '../../config/env';
import { parseConfig } from '../../config/parser';
import { buildEndpointMap } from '../../endpoint';
import { logger } from '../../logger';
import { handleEndpointRequest } from '../../pipeline';
import { loadPlugins } from '../../plugins';
import { createSemaphore } from '../../semaphore';
import { createServer } from '../../server';
import { accountFromEnv } from '../../sign';
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

    const resolved = accountFromEnv();
    if (!resolved.success) {
      logger.error(resolved.error);
      // eslint-disable-next-line unicorn/no-process-exit
      process.exit(1);
    }
    const account = resolved.account;

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
    const apiCallSemaphore = createSemaphore(config.settings.maxConcurrentApiCalls);
    const server = createServer({
      config,
      account,
      airnode: account.address,
      endpointMap,
      plugins,
      cache,
      asyncStore,
      apiCallSemaphore,
      settings: config.settings,
      rateLimit: config.server.rateLimit,
      handleRequest: handleEndpointRequest,
    });

    const shutdown = async (): Promise<void> => {
      logger.info('Shutting down — letting in-flight requests finish...');
      await server.stop(); // resolves once active requests have drained
      cache.stop();
      asyncStore.stop();
      logger.info('Shutdown complete.');
      // eslint-disable-next-line unicorn/no-process-exit
      process.exit(0);
    };

    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  });
