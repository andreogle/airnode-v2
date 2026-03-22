import path from 'node:path';
import { Command } from 'commander';
import { createCacheServer } from '../../cache-server';
import { loadEnvFile } from '../../config/env';
import { parseCacheServerConfig } from '../../config/parser';
import { logger } from '../../logger';
import { VERSION } from '../../version';
import { printCacheServerBanner } from '../banner';

const DEFAULT_CONFIG_PATH = 'cache-server.yaml';
const DEFAULT_ENV_PATH = '.env';

interface RunOptions {
  readonly config: string;
  readonly env: string;
}

export const cacheServer = new Command('cache-server')
  .description('Start the cache server for signed beacon data')
  .option('-c, --config <path>', 'Path to config file', DEFAULT_CONFIG_PATH)
  .option('-e, --env <path>', 'Path to .env file', DEFAULT_ENV_PATH)
  .action(async (options: RunOptions) => {
    const configPath = path.resolve(options.config);
    const envPath = path.resolve(options.env);

    await loadEnvFile(envPath);

    const raw = await Bun.file(configPath).text();
    const config = parseCacheServerConfig(raw);

    printCacheServerBanner({
      version: VERSION,
      host: config.server.host,
      port: config.server.port,
      endpoints: config.endpoints.length,
    });

    const airnodeCount = String(config.allowedAirnodes.length);
    logger.info(`Config loaded: ${airnodeCount} allowed airnode(s), ${String(config.endpoints.length)} endpoint(s)`);

    const server = createCacheServer({ config });

    const shutdown = (): void => {
      server.stop();
      // eslint-disable-next-line unicorn/no-process-exit
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
