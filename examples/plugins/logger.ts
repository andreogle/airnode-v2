/* eslint-disable no-console */
// =============================================================================
// Logger plugin
//
// Logs a message at every lifecycle hook, showing the context each hook
// receives. Useful as a reference for plugin authors and for debugging the
// request pipeline during development.
//
// This plugin is observation-only — it never modifies parameters, drops
// requests, or overrides responses, so it won't affect the worker pool or
// request processing in any way.
//
// Usage (in config.yaml):
//   settings:
//     plugins:
//       - source: ./examples/plugins/logger.ts
//         timeout: 5000
// =============================================================================

// =============================================================================
// Plugin types (inlined — the package does not export them yet)
// =============================================================================
type Hex = `0x${string}`;

interface ApiCallResult {
  readonly data: unknown;
  readonly status: number;
}

interface HttpRequestContext {
  readonly endpointId: Hex;
  readonly api: string;
  readonly endpoint: string;
  readonly parameters: Record<string, string>;
}

interface BeforeApiCallContext {
  readonly endpointId: Hex;
  readonly api: string;
  readonly endpoint: string;
  readonly parameters: Record<string, string>;
}

interface AfterApiCallContext {
  readonly endpointId: Hex;
  readonly api: string;
  readonly endpoint: string;
  readonly parameters: Record<string, string>;
  readonly response: ApiCallResult;
}

interface BeforeSignContext {
  readonly endpointId: Hex;
  readonly api: string;
  readonly endpoint: string;
  readonly data: Hex;
}

interface ResponseSentContext {
  readonly endpointId: Hex;
  readonly api: string;
  readonly endpoint: string;
  readonly duration: number;
}

interface ErrorContext {
  readonly error: Error;
  readonly stage: string;
  readonly endpointId?: Hex;
}

interface AirnodePlugin {
  readonly name: string;
  readonly hooks: {
    readonly onHttpRequest?: (context: HttpRequestContext) => void;
    readonly onBeforeApiCall?: (context: BeforeApiCallContext) => void;
    readonly onAfterApiCall?: (context: AfterApiCallContext) => void;
    readonly onBeforeSign?: (context: BeforeSignContext) => void;
    readonly onResponseSent?: (context: ResponseSentContext) => void;
    readonly onError?: (context: ErrorContext) => void;
  };
}

// =============================================================================
// Helpers
// =============================================================================
const PREFIX = '[logger]';

// =============================================================================
// Plugin implementation
// =============================================================================
const plugin: AirnodePlugin = {
  name: 'logger',
  hooks: {
    onHttpRequest: (ctx) => {
      console.log(
        `${PREFIX} HTTP request for ${ctx.api}/${ctx.endpoint} (endpoint: ${ctx.endpointId.slice(0, 10)}...)`
      );
    },

    onBeforeApiCall: (ctx) => {
      console.log(
        `${PREFIX} Calling API ${ctx.api}/${ctx.endpoint} with ${String(Object.keys(ctx.parameters).length)} parameter(s)`
      );
    },

    onAfterApiCall: (ctx) => {
      console.log(`${PREFIX} ${ctx.api}/${ctx.endpoint} returned status ${String(ctx.response.status)}`);
    },

    onBeforeSign: (ctx) => {
      console.log(
        `${PREFIX} Signing response for ${ctx.api}/${ctx.endpoint} (${String(ctx.data.length)} bytes encoded)`
      );
    },

    onResponseSent: (ctx) => {
      console.log(`${PREFIX} Response sent for ${ctx.api}/${ctx.endpoint} in ${String(ctx.duration)}ms`);
    },

    onError: (ctx) => {
      const endpoint = ctx.endpointId ? ` endpoint=${ctx.endpointId.slice(0, 10)}...` : '';
      console.log(`${PREFIX} Error in ${ctx.stage}${endpoint}: ${ctx.error.message}`);
    },
  },
};

export default plugin;
