/* eslint-disable no-console */
import path from 'node:path';
import { Command } from 'commander';
import { validateConfig } from '../../config/validate';
import type { Api } from '../../types';

interface ValidateOptions {
  readonly config: string;
  readonly interpolate?: boolean;
}

// =============================================================================
// Helpers
// =============================================================================
function formatErrors(errors: readonly string[]): string {
  return errors.map((e) => `  - ${e}`).join('\n');
}

// =============================================================================
// Commands
// =============================================================================
export const config = new Command('config').description('Config management commands');

// =============================================================================
// validate
// =============================================================================
config
  .command('validate')
  .description('Validate an Airnode config file')
  .requiredOption('-c, --config <path>', 'Path to config file')
  .option('--interpolate', 'Resolve ${VAR} references from environment before validating')
  .action(async (options: ValidateOptions) => {
    const configPath = path.resolve(options.config);
    const raw = await Bun.file(configPath).text();
    const result = validateConfig(raw, options.interpolate);

    if (!result.success) {
      console.error(`\nValidation failed:\n${formatErrors(result.errors)}`);
      // eslint-disable-next-line unicorn/no-process-exit
      process.exit(1);
    }

    console.log(
      `Config is valid: ${String(result.config.apis.length)} API(s), ${String(result.config.apis.reduce((sum, api: Api) => sum + api.endpoints.length, 0))} endpoint(s)`
    );
  });
