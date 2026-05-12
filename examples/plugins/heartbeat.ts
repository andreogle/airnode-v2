// =============================================================================
// Heartbeat plugin
//
// Sends a POST request to a configured URL after each response is sent, with
// basic request stats. Useful for uptime monitoring and alerting.
//
// Usage (in config.yaml):
//   settings:
//     plugins:
//       - source: ./examples/plugins/heartbeat.ts
//         timeout: 5000
//         config:
//           url: ${HEARTBEAT_URL}         # where to POST the heartbeat (optional)
//           apiKey: ${HEARTBEAT_API_KEY}  # sent in the x-api-key header (optional)
//
// The airnode validates `config` against `configSchema` (below) on startup, so a
// typo in the URL fails the boot rather than silently disabling the heartbeat.
// =============================================================================

import { z } from 'zod/v4';

// =============================================================================
// Plugin types (inlined — the package does not export them yet)
// =============================================================================
type Hex = `0x${string}`;

interface ResponseSentContext {
  readonly endpointId: Hex;
  readonly api: string;
  readonly endpoint: string;
  readonly duration: number;
  readonly signal: AbortSignal;
}

interface AirnodePlugin {
  readonly name: string;
  readonly hooks: {
    readonly onResponseSent?: (context: ResponseSentContext) => void | Promise<void>;
  };
}

// =============================================================================
// Config — validated by the airnode at startup
// =============================================================================
export const configSchema = z.object({
  url: z.url().optional(),
  apiKey: z.string().min(1).optional(),
});

type Config = z.infer<typeof configSchema>;

// =============================================================================
// Heartbeat payload
// =============================================================================
interface HeartbeatPayload {
  readonly timestamp: string;
  readonly endpointId: string;
  readonly api: string;
  readonly endpoint: string;
  readonly durationMs: number;
}

// =============================================================================
// Plugin factory — receives the validated config and returns the plugin
// =============================================================================
export default function heartbeat(config: Config): AirnodePlugin {
  return {
    name: 'heartbeat',
    hooks: {
      onResponseSent: async (context: ResponseSentContext) => {
        if (!config.url) return;

        const payload: HeartbeatPayload = {
          timestamp: new Date().toISOString(),
          endpointId: context.endpointId,
          api: context.api,
          endpoint: context.endpoint,
          durationMs: context.duration,
        };

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...(config.apiKey ? { 'x-api-key': config.apiKey } : {}),
        };

        await fetch(config.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: context.signal,
        });
      },
    },
  };
}
