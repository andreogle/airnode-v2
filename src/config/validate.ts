import { goSync } from '@api3/promise-utils';
import { parse } from 'yaml';
import type { z } from 'zod/v4';
import { interpolateEnvironment } from './parser';
import { configSchema } from './schema';

// =============================================================================
// Validation result
// =============================================================================
interface ValidationSuccess {
  readonly success: true;
  readonly config: z.infer<typeof configSchema>;
}

interface ValidationFailure {
  readonly success: false;
  readonly errors: readonly string[];
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

// =============================================================================
// Cross-field checks (beyond what Zod can express)
// =============================================================================
function crossFieldErrors(config: z.infer<typeof configSchema>): readonly string[] {
  const duplicateApiNames = config.apis.map((a) => a.name).filter((name, i, all) => all.indexOf(name) !== i);
  const apiNameErrors =
    duplicateApiNames.length > 0 ? [`Duplicate API name(s): ${[...new Set(duplicateApiNames)].join(', ')}`] : [];

  const endpointNameErrors = config.apis.flatMap((api) => {
    const names = api.endpoints.map((e) => e.name);
    const duplicates = names.filter((name, i, all) => all.indexOf(name) !== i);
    return duplicates.length > 0
      ? [`Duplicate endpoint name(s) in API "${api.name}": ${[...new Set(duplicates)].join(', ')}`]
      : [];
  });

  const pluginSources = config.settings.plugins.map((p) => p.source);
  const duplicatePluginSources = pluginSources.filter((source, i, all) => all.indexOf(source) !== i);
  const pluginErrors =
    duplicatePluginSources.length > 0
      ? [`Duplicate plugin source(s): ${[...new Set(duplicatePluginSources)].join(', ')}`]
      : [];

  return [...apiNameErrors, ...endpointNameErrors, ...pluginErrors];
}

// =============================================================================
// Format Zod errors into human-readable strings
// =============================================================================
function formatZodError(error: z.core.$ZodError): readonly string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.message}`;
  });
}

// =============================================================================
// Main validation
// =============================================================================
export function validateConfig(raw: string, interpolate = false): ValidationResult {
  const input = interpolate ? goSync(() => interpolateEnvironment(raw)) : { success: true as const, data: raw };
  if (!input.success) {
    return { success: false, errors: [input.error.message] };
  }

  const parseResult = goSync(() => parse(input.data) as unknown);
  if (!parseResult.success) {
    return { success: false, errors: [`YAML parse error: ${parseResult.error.message}`] };
  }

  const schemaResult = configSchema.safeParse(parseResult.data);
  if (!schemaResult.success) {
    return { success: false, errors: formatZodError(schemaResult.error) };
  }

  const crossErrors = crossFieldErrors(schemaResult.data);
  if (crossErrors.length > 0) {
    return { success: false, errors: crossErrors };
  }

  return { success: true, config: schemaResult.data };
}
