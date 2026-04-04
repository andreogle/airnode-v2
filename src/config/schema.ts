import { z } from 'zod/v4';

// =============================================================================
// Primitives
// =============================================================================
const httpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

// =============================================================================
// Parameters
// =============================================================================
export const parameterSchema = z
  .object({
    name: z.string().min(1),
    in: z.enum(['query', 'header', 'path', 'cookie', 'body']).default('query'),
    required: z.boolean().default(false),
    fixed: z.union([z.string(), z.number(), z.boolean()]).optional(),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    secret: z.boolean().default(false),
    description: z.string().optional(),
  })
  .refine((p) => !(p.required && p.default !== undefined), {
    message: 'A parameter cannot be both required and have a default value',
  });

// =============================================================================
// Encoding (response processing)
// =============================================================================
export const encodingSchema = z.object({
  type: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  times: z.string().optional(),
});

// =============================================================================
// Client-facing auth
// =============================================================================
const evmAddressSchema = z.string().regex(/^0x[\da-fA-F]{40}$/, 'Must be a valid EVM address');

const apiKeyClientAuthSchema = z.object({
  type: z.literal('apiKey'),
  keys: z.array(z.string().min(1)).min(1),
});

const freeClientAuthSchema = z.object({
  type: z.literal('free'),
});

const x402ClientAuthSchema = z.object({
  type: z.literal('x402'),
  network: z.number().int().positive(),
  rpc: z.url(),
  token: evmAddressSchema,
  amount: z.string().min(1),
  recipient: evmAddressSchema,
  expiry: z.number().int().positive().default(300_000),
});

export const clientAuthMethodSchema = z.discriminatedUnion('type', [
  apiKeyClientAuthSchema,
  freeClientAuthSchema,
  x402ClientAuthSchema,
]);

// Auth can be a single method or an array of methods (any-of semantics)
export const clientAuthSchema = z.union([clientAuthMethodSchema, z.array(clientAuthMethodSchema).min(1)]);

// =============================================================================
// Cache
// =============================================================================
export const cacheSchema = z.object({
  maxAge: z.number().int().positive(),
  delay: z.number().int().nonnegative().optional(),
});

// =============================================================================
const endpointModeSchema = z.enum(['sync', 'async', 'stream']).default('sync');

export const endpointSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  method: httpMethodSchema.default('GET'),
  mode: endpointModeSchema,
  parameters: z.array(parameterSchema).default([]),
  encoding: encodingSchema.optional(),
  auth: clientAuthSchema.optional(),
  cache: cacheSchema.optional(),
  description: z.string().optional(),
});

// =============================================================================
// APIs
// =============================================================================
export const apiSchema = z.object({
  name: z.string().min(1),
  url: z.url(),
  headers: z.record(z.string(), z.string()).optional(),
  auth: clientAuthSchema.optional(),
  cache: cacheSchema.optional(),
  timeout: z.number().int().positive().default(10_000),
  endpoints: z.array(endpointSchema).min(1),
});

// =============================================================================
// Server
// =============================================================================
const corsSchema = z.object({
  origins: z.array(z.string().min(1)).default(['*']),
});

const rateLimitSchema = z.object({
  window: z.number().int().positive(),
  max: z.number().int().positive(),
});

export const serverSchema = z.object({
  port: z.number().int().positive(),
  host: z.string().default('0.0.0.0'),
  cors: corsSchema.optional(),
  rateLimit: rateLimitSchema.optional(),
});

// =============================================================================
// Settings
// =============================================================================
const pluginEntrySchema = z.object({
  source: z.string().min(1),
  timeout: z.number().int().positive(),
});

export const settingsSchema = z.object({
  timeout: z.number().int().positive().default(10_000),
  proof: z.literal('none'),
  plugins: z.array(pluginEntrySchema).default([]),
});

// =============================================================================
// Top-level config
// =============================================================================
export const configSchema = z.object({
  version: z.literal('1.0'),
  server: serverSchema,
  apis: z.array(apiSchema).min(1),
  settings: settingsSchema,
});
