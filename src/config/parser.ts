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

// =============================================================================
// Secret parameter detection (must run before interpolation)
//
// A parameter whose `fixed` value references an env var (e.g. `fixed: ${API_KEY}`)
// is treated as secret: its resolved value is excluded from the endpoint ID. This
// has to be detected on the *un-interpolated* config — once `${VAR}` has been
// replaced with the value, there is nothing left to recognise. Interpolation only
// rewrites scalar text (it never adds, removes, or reorders keys), so each
// parameter occupies the same position in the raw and interpolated parses, and we
// can mark `secret: true` on the corresponding entry in the interpolated tree.
// =============================================================================
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function markEnvBackedFixedParamsSecret(raw: unknown, interpolated: unknown): void {
  const rawApis = asArray(asRecord(raw)?.['apis']);
  const apis = asArray(asRecord(interpolated)?.['apis']);
  // eslint-disable-next-line functional/no-loop-statements
  for (const [apiIndex, rawApi] of rawApis.entries()) {
    const rawEndpoints = asArray(asRecord(rawApi)?.['endpoints']);
    const endpoints = asArray(asRecord(apis[apiIndex])?.['endpoints']);
    // eslint-disable-next-line functional/no-loop-statements
    for (const [endpointIndex, rawEndpoint] of rawEndpoints.entries()) {
      const rawParams = asArray(asRecord(rawEndpoint)?.['parameters']);
      const params = asArray(asRecord(endpoints[endpointIndex])?.['parameters']);
      // eslint-disable-next-line functional/no-loop-statements
      for (const [paramIndex, rawParam] of rawParams.entries()) {
        const fixed = asRecord(rawParam)?.['fixed'];
        if (typeof fixed !== 'string' || !fixed.startsWith('${')) continue;
        const target = asRecord(params[paramIndex]);
        if (target) target['secret'] = true; // eslint-disable-line functional/immutable-data
      }
    }
  }
}

export function parseConfig(raw: string): Config {
  const interpolated = interpolateEnvironment(raw);
  const data: unknown = parse(interpolated);
  markEnvBackedFixedParamsSecret(parse(raw), data);
  return configSchema.parse(data);
}
