import type { z } from 'zod/v4';
import type {
  apiSchema,
  cacheSchema,
  clientAuthMethodSchema,
  clientAuthSchema,
  configSchema,
  encodingSchema,
  endpointSchema,
  parameterSchema,
  serverSchema,
  settingsSchema,
} from './config/schema';

export type Config = z.infer<typeof configSchema>;
export type Api = z.infer<typeof apiSchema>;
export type Endpoint = z.infer<typeof endpointSchema>;
export type Parameter = z.infer<typeof parameterSchema>;
export type Encoding = z.infer<typeof encodingSchema>;
export type ClientAuth = z.infer<typeof clientAuthSchema>;
export type ClientAuthMethod = z.infer<typeof clientAuthMethodSchema>;
export type Cache = z.infer<typeof cacheSchema>;
export type Server = z.infer<typeof serverSchema>;
export type Settings = z.infer<typeof settingsSchema>;
