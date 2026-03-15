import { parse } from 'yaml';
import type { Config } from '../types';
import { configSchema } from './schema';

const ENV_VAR_PATTERN = /\$\{(\w+)\}/g;

export function interpolateEnvironment(raw: string): string {
  return raw.replaceAll(ENV_VAR_PATTERN, (match, name: string) => {
    const value = process.env[name];
    if (value === undefined) {
      throw new Error(`Environment variable ${name} is referenced in config but not set`);
    }
    return value;
  });
}

export function parseConfig(raw: string): Config {
  const interpolated = interpolateEnvironment(raw);
  const data: unknown = parse(interpolated);
  return configSchema.parse(data);
}
