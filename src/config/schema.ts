import { z } from 'zod/v4';

// =============================================================================
// Primitives
// =============================================================================
const httpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

const evmAddressSchema = z.string().regex(/^0x[\da-fA-F]{40}$/, 'Must be a valid EVM address');

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
// FHE encryption (per-endpoint opt-in)
//
// When set, the ABI-encoded response value is replaced with an FHE ciphertext
// before signing (see `src/fhe.ts`). `type` is the FHE ciphertext type — it
// determines how the integer is packed into the encrypted input (euint64 →
// add64, euint256 → add256, ...). `contract` is the on-chain consumer the
// encrypted input is bound to: the signed ciphertext can only be used by that
// contract, which prevents replaying encrypted values across contexts. The
// contract is fixed by the operator — requesters cannot override it.
//
// Encryption requires the response to encode to a single non-negative integer,
// so `encoding` must be present with `type` set to `int256` or `uint256` and
// `path` set (both operator-fixed). The relayer connection is configured once
// at the settings level (`settings.fhe`).
// =============================================================================
const ENCRYPTABLE_ENCODING_TYPES = new Set(['int256', 'uint256']);

export const encryptSchema = z.object({
  type: z.enum(['euint8', 'euint16', 'euint32', 'euint64', 'euint128', 'euint256']),
  contract: evmAddressSchema,
});

// =============================================================================
// Client-facing auth
// =============================================================================
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
  // Base-unit integer amount (e.g. wei, or token base units) — kept as a string
  // to preserve precision and parsed with BigInt at request time, so it must be
  // a plain non-negative integer with no decimal point, sign, or units.
  amount: z.string().regex(/^\d+$/, 'Must be a non-negative integer string (token base units)'),
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
});

// =============================================================================
// Endpoints
// =============================================================================
const endpointModeSchema = z.enum(['sync', 'async', 'stream']).default('sync');

const responseMatchSchema = z.object({
  type: z.literal('regex'),
  value: z.string().min(1),
});

export const endpointSchema = z
  .object({
    name: z.string().min(1),
    path: z.string().min(1),
    method: httpMethodSchema.default('GET'),
    mode: endpointModeSchema,
    parameters: z.array(parameterSchema).default([]),
    encoding: encodingSchema.optional(),
    encrypt: encryptSchema.optional(),
    responseMatches: z.array(responseMatchSchema).min(1).optional(),
    auth: clientAuthSchema.optional(),
    cache: cacheSchema.optional(),
    description: z.string().optional(),
  })
  .refine(
    (endpoint) => {
      if (!endpoint.encrypt) return true;
      if (!endpoint.encoding?.type || !endpoint.encoding.path) return false;
      return ENCRYPTABLE_ENCODING_TYPES.has(endpoint.encoding.type);
    },
    {
      message: '`encrypt` requires `encoding` with `path` set and `type` set to `int256` or `uint256`',
      path: ['encrypt'],
    }
  );

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
  // When Airnode runs behind a reverse proxy the socket peer is the proxy, so
  // every client shares one bucket. Set this only if a *trusted* proxy sets
  // `X-Forwarded-For` — its first entry is then used as the rate-limit key.
  trustForwardedFor: z.boolean().default(false),
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
  // Explicit, scoped config handed to the plugin (instead of the plugin reaching
  // into `process.env` itself). Values support `${ENV}` interpolation like the
  // rest of the config. The plugin's own exported `configSchema` (if any) is
  // validated against this at startup; otherwise the shape is the plugin's
  // responsibility.
  config: z.record(z.string(), z.unknown()).default({}),
});

const reclaimProofSchema = z.object({
  type: z.literal('reclaim'),
  gatewayUrl: z.url(),
  // The proof is fetched after signing on the sync path, so this latency is
  // added to the response. Non-fatal: a timeout just omits the `proof` field.
  timeout: z.number().int().positive().default(30_000),
});

const proofSchema = z.union([z.literal('none'), reclaimProofSchema]);

// FHE relayer connection. `none` disables FHE entirely. The object form
// configures the Zama relayer used to fetch the target chain's FHE public key
// and produce encrypted inputs.
//
// `verifier` is the AirnodeVerifier contract deployed on the fhEVM chain. An
// fhEVM encrypted input is bound to the contract that ingests it *and* to the
// address that calls that contract — and in the Airnode flow a consumer's
// callback is invoked by AirnodeVerifier, so AirnodeVerifier's address is the
// "user address" the proof must commit to. Requesters routing through a
// different AirnodeVerifier deployment will not be able to ingest the data.
//
// `rpcUrl` and `apiKey` may reference secrets via `${VAR}` interpolation.
const fheSchema = z.union([
  z.literal('none'),
  z.object({
    network: z.enum(['sepolia', 'mainnet']),
    rpcUrl: z.url(),
    verifier: evmAddressSchema,
    apiKey: z.string().min(1).optional(),
  }),
]);

export const settingsSchema = z.object({
  timeout: z.number().int().positive().default(10_000),
  proof: proofSchema.default('none'),
  fhe: fheSchema.default('none'),
  plugins: z.array(pluginEntrySchema).default([]),
});

// =============================================================================
// Top-level config
// =============================================================================
export const configSchema = z
  .object({
    version: z.literal('1.0'),
    server: serverSchema,
    apis: z.array(apiSchema).min(1),
    settings: settingsSchema,
  })
  .refine(
    (config) => {
      const usesFhe = config.apis.some((api) => api.endpoints.some((endpoint) => endpoint.encrypt !== undefined));
      return !usesFhe || config.settings.fhe !== 'none';
    },
    {
      message: 'An endpoint is configured with `encrypt` but `settings.fhe` is `none` — configure the FHE relayer',
      path: ['settings', 'fhe'],
    }
  );
