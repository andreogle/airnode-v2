import { parse } from 'yaml';
import type { CacheServerConfig, Config } from '../types';
import { cacheServerConfigSchema, configSchema } from './schema';

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

export function parseCacheServerConfig(raw: string): CacheServerConfig {
  const interpolated = interpolateEnvironment(raw);
  const data: unknown = parse(interpolated);
  return cacheServerConfigSchema.parse(data);
}
