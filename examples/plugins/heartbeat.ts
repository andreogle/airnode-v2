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
//
// Environment variables:
//   HEARTBEAT_URL     - URL to POST the heartbeat payload to (required)
//   HEARTBEAT_API_KEY - API key sent in the x-api-key header (optional)
// =============================================================================

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
// Plugin implementation
// =============================================================================
const HEARTBEAT_URL = process.env['HEARTBEAT_URL'];
const HEARTBEAT_API_KEY = process.env['HEARTBEAT_API_KEY'];

const plugin: AirnodePlugin = {
  name: 'heartbeat',
  hooks: {
    onResponseSent: async (context: ResponseSentContext) => {
      if (!HEARTBEAT_URL) return;

      const payload: HeartbeatPayload = {
        timestamp: new Date().toISOString(),
        endpointId: context.endpointId,
        api: context.api,
        endpoint: context.endpoint,
        durationMs: context.duration,
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(HEARTBEAT_API_KEY ? { 'x-api-key': HEARTBEAT_API_KEY } : {}),
      };

      await fetch(HEARTBEAT_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: context.signal,
      });
    },
  },
};

export default plugin;
