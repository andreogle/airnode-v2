// =============================================================================
// Airnode plugin types
//
// Copy these into your plugin file until the package exports them directly.
// =============================================================================

// Hex-prefixed string (e.g. "0xabc123...")
type Hex = `0x${string}`;

// =============================================================================
// Shared types
// =============================================================================
interface ApiCallResult {
  readonly data: unknown;
  readonly status: number;
}

// =============================================================================
// Hook context types
//
// Every context includes `signal: AbortSignal` — pass it to fetch() or any
// async work so the node can abort your hook if its per-request budget expires.
// =============================================================================
interface HttpRequestContext {
  readonly endpointId: Hex;
  readonly api: string;
  readonly endpoint: string;
  readonly parameters: Record<string, string>;
  readonly signal: AbortSignal;
}

interface BeforeApiCallContext {
  readonly endpointId: Hex;
  readonly api: string;
  readonly endpoint: string;
  readonly parameters: Record<string, string>;
  readonly signal: AbortSignal;
}

interface AfterApiCallContext {
  readonly endpointId: Hex;
  readonly api: string;
  readonly endpoint: string;
  readonly parameters: Record<string, string>;
  readonly response: ApiCallResult;
  readonly signal: AbortSignal;
}

interface BeforeSignContext {
  readonly endpointId: Hex;
  readonly api: string;
  readonly endpoint: string;
  readonly data: Hex;
  readonly signal: AbortSignal;
}

interface ResponseSentContext {
  readonly endpointId: Hex;
  readonly api: string;
  readonly endpoint: string;
  readonly duration: number;
  readonly signal: AbortSignal;
}

interface ErrorContext {
  readonly error: Error;
  readonly stage: string;
  readonly endpointId?: Hex;
  readonly signal: AbortSignal;
}

// =============================================================================
// Hook return types
//
// Mutation hooks return undefined (or void) to pass through unchanged.
// If a mutation hook exceeds its per-request budget, the affected request is
// dropped — the node will not process it rather than risk leaking data.
// =============================================================================
type HttpRequestResult = { readonly reject: true; readonly status: number; readonly message: string } | undefined;
type BeforeApiCallResult = { readonly parameters: Record<string, string> } | undefined;
type AfterApiCallResult = { readonly data: unknown; readonly status: number } | undefined;
type BeforeSignResult = { readonly data: Hex } | undefined;

// =============================================================================
// Plugin interface
// =============================================================================
interface PluginHooks {
  readonly onHttpRequest?: (context: HttpRequestContext) => HttpRequestResult | Promise<HttpRequestResult>;
  readonly onBeforeApiCall?: (context: BeforeApiCallContext) => BeforeApiCallResult | Promise<BeforeApiCallResult>;
  readonly onAfterApiCall?: (context: AfterApiCallContext) => AfterApiCallResult | Promise<AfterApiCallResult>;
  readonly onBeforeSign?: (context: BeforeSignContext) => BeforeSignResult | Promise<BeforeSignResult>;
  readonly onResponseSent?: (context: ResponseSentContext) => void | Promise<void>;
  readonly onError?: (context: ErrorContext) => void | Promise<void>;
}

interface AirnodePlugin {
  readonly name: string;
  readonly hooks: PluginHooks;
}

export type {
  AfterApiCallContext,
  AfterApiCallResult,
  AirnodePlugin,
  ApiCallResult,
  BeforeApiCallContext,
  BeforeApiCallResult,
  BeforeSignContext,
  BeforeSignResult,
  ErrorContext,
  Hex,
  HttpRequestContext,
  HttpRequestResult,
  PluginHooks,
  ResponseSentContext,
};
