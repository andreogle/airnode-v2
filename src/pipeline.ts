import { go } from '@api3/promise-utils';
import { type Hex, keccak256, toHex } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import { callApi } from './api/call';
import { processResponse } from './api/process';
import type { AsyncRequestStore } from './async';
import { authenticateRequest, isPaymentRequired } from './auth';
import type { ResponseCache } from './cache';
import type { ResolvedEndpoint } from './endpoint';
import { isNil } from './guards';
import { logger, runWithContext } from './logger';
import type { PluginRegistry } from './plugins';
import { signResponse } from './sign';
import type { ClientAuth, Encoding } from './types';

// =============================================================================
// Types
// =============================================================================
interface PipelineDependencies {
  readonly account: PrivateKeyAccount;
  readonly airnode: Hex;
  readonly endpointMap: ReadonlyMap<Hex, ResolvedEndpoint>;
  readonly plugins: PluginRegistry;
  readonly cache: ResponseCache;
  readonly asyncStore?: AsyncRequestStore;
}

interface SignedResponseBody {
  readonly airnode: Hex;
  readonly endpointId: Hex;
  readonly timestamp: number;
  readonly data: Hex;
  readonly signature: Hex;
}

interface RawResponseBody {
  readonly airnode: Hex;
  readonly endpointId: Hex;
  readonly timestamp: number;
  readonly rawData: unknown;
  readonly signature: Hex;
}

// =============================================================================
// Helpers
// =============================================================================
function unixTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  const sortedEntries = Object.entries(value as Record<string, unknown>)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${sortedEntries.join(',')}}`;
}

function resolveAuth(resolved: ResolvedEndpoint): ClientAuth | undefined {
  return resolved.endpoint.auth ?? resolved.api.auth;
}

function resolveCacheMaxAge(resolved: ResolvedEndpoint): number | undefined {
  const cacheConfig = resolved.endpoint.cache ?? resolved.api.cache;
  return cacheConfig?.maxAge;
}

function validateRequiredParameters(
  resolved: ResolvedEndpoint,
  parameters: Record<string, string>
): string | undefined {
  const missing = resolved.endpoint.parameters
    .filter((p) => p.required && p.fixed === undefined && p.default === undefined)
    .filter((p) => parameters[p.name] === undefined)
    .map((p) => p.name);

  if (missing.length === 0) return undefined;
  return `Missing required parameter(s): ${missing.join(', ')}`;
}

// =============================================================================
// Response builders
// =============================================================================
async function buildSignedResponse(
  endpointId: Hex,
  data: Hex,
  deps: PipelineDependencies
): Promise<SignedResponseBody> {
  const timestamp = unixTimestamp();
  const signed = await signResponse(deps.account, endpointId, timestamp, data);

  return {
    airnode: deps.airnode,
    endpointId,
    timestamp,
    data,
    signature: signed.signature,
  };
}

async function buildRawResponse(
  endpointId: Hex,
  rawData: unknown,
  deps: PipelineDependencies
): Promise<RawResponseBody> {
  const timestamp = unixTimestamp();
  const dataHash = keccak256(toHex(stableStringify(rawData)));
  const signed = await signResponse(deps.account, endpointId, timestamp, dataHash);

  return {
    airnode: deps.airnode,
    endpointId,
    timestamp,
    rawData: rawData ?? null, // eslint-disable-line unicorn/no-null
    signature: signed.signature,
  };
}

// =============================================================================
// Requester-specified encoding
//
// Clients can pass _type, _path, and _times in their request parameters to
// control encoding. Three modes:
//
// 1. Operator-fixed: encoding block has type+path. Requester params ignored.
// 2. Partial: encoding block has some fields (e.g. type only). Requester
//    fills in the rest. Operator fields take precedence.
// 3. Requester-only: no encoding block. Requester provides _type+_path.
//
// If the merged result has neither type nor path, raw mode is used. If it
// has one but not the other, return 400.
// =============================================================================
const RESERVED_PARAM_TYPE = '_type';
const RESERVED_PARAM_PATH = '_path';
const RESERVED_PARAM_TIMES = '_times';

interface ResolvedEncoding {
  readonly type: string;
  readonly path: string;
  readonly times?: string;
}

function resolveEncoding(
  configEncoding: Encoding | undefined,
  parameters: Record<string, string>
): ResolvedEncoding | 'invalid' | undefined {
  const type = configEncoding?.type ?? parameters[RESERVED_PARAM_TYPE];
  const path = configEncoding?.path ?? parameters[RESERVED_PARAM_PATH];
  const times = configEncoding?.times ?? parameters[RESERVED_PARAM_TIMES];

  if (!type && !path) return undefined;
  if (!type || !path) return 'invalid';

  return times ? { type, path, times } : { type, path };
}

// =============================================================================
// API call pipeline
// =============================================================================
async function executeApiCall(
  resolved: ResolvedEndpoint,
  endpointId: Hex,
  parameters: Record<string, string>,
  deps: PipelineDependencies
): Promise<Response> {
  const beforeResult = await deps.plugins.callBeforeApiCall({
    endpointId,
    api: resolved.api.name,
    endpoint: resolved.endpoint.name,
    parameters,
  });
  if (beforeResult.dropped) {
    return jsonResponse({ error: 'Request dropped by plugin' }, 403);
  }

  const resolvedParameters = beforeResult.parameters;

  const apiResult = await go(() => callApi(resolved.api, resolved.endpoint, resolvedParameters));
  if (!apiResult.success) {
    logger.error(`API call failed for endpoint ${endpointId}: ${apiResult.error.message}`);
    void deps.plugins.callError({ error: apiResult.error, stage: 'apiCall', endpointId });
    return jsonResponse({ error: 'API call failed' }, 502);
  }

  const afterResult = await deps.plugins.callAfterApiCall({
    endpointId,
    api: resolved.api.name,
    endpoint: resolved.endpoint.name,
    parameters: resolvedParameters,
    response: apiResult.data,
  });
  if (afterResult.dropped) {
    return jsonResponse({ error: 'Request dropped by plugin' }, 403);
  }

  const apiResponse = afterResult.response;

  // Resolve encoding: merge operator config with requester params (operator takes precedence)
  const encoding = resolveEncoding(resolved.endpoint.encoding, resolvedParameters);
  if (encoding === 'invalid') {
    return jsonResponse({ error: 'Both _type and _path are required for encoding' }, 400);
  }

  if (encoding) {
    if (isNil(apiResponse.data)) {
      return jsonResponse({ error: 'API returned no data to encode' }, 502);
    }

    const encodedData = processResponse(apiResponse.data, encoding);

    const signResult = await deps.plugins.callBeforeSign({
      endpointId,
      api: resolved.api.name,
      endpoint: resolved.endpoint.name,
      data: encodedData,
    });
    if (signResult.dropped) {
      return jsonResponse({ error: 'Request dropped by plugin' }, 403);
    }

    const responseBody = await buildSignedResponse(endpointId, signResult.data, deps);
    return jsonResponse(responseBody);
  }

  const responseBody = await buildRawResponse(endpointId, apiResponse.data, deps);
  return jsonResponse(responseBody);
}

// =============================================================================
// Async request handler
// =============================================================================
function handleAsyncRequest(
  resolved: ResolvedEndpoint,
  endpointId: Hex,
  parameters: Record<string, string>,
  deps: PipelineDependencies
): Response {
  const store = deps.asyncStore;
  if (!store) return jsonResponse({ error: 'Async not configured' }, 500);

  const pending = store.create(endpointId);
  if (!pending) {
    return jsonResponse({ error: 'Too many pending requests' }, 503);
  }

  // Process in background
  void (async () => {
    store.setProcessing(pending.requestId);
    const result = await go(() => executeApiCall(resolved, endpointId, parameters, deps));
    if (!result.success) {
      store.setFailed(pending.requestId, 'Pipeline execution failed');
      return;
    }
    if (result.data.status !== 200) {
      store.setFailed(pending.requestId, 'API call returned an error');
      return;
    }
    const body = await result.data.json();
    store.setComplete(pending.requestId, body);
  })();

  return jsonResponse(
    {
      requestId: pending.requestId,
      status: 'pending',
      pollUrl: `/requests/${pending.requestId}`,
    },
    202
  );
}

// =============================================================================
// SSE streaming handler
//
// Runs the full pipeline (plugins included) via executeApiCall, then wraps the
// signed result in a single SSE event. Real incremental streaming (proxying
// chunked upstream responses) requires the upstream API to support it — that's
// a future enhancement. For now, the SSE format lets clients use EventSource
// and receive the signed response as a server-pushed event.
// =============================================================================
async function handleStreamingRequest(
  resolved: ResolvedEndpoint,
  endpointId: Hex,
  parameters: Record<string, string>,
  deps: PipelineDependencies
): Promise<Response> {
  // Run the full pipeline (same as sync, with all plugin hooks)
  const result = await go(() => executeApiCall(resolved, endpointId, parameters, deps));
  if (!result.success) {
    return jsonResponse({ error: 'API call failed' }, 502);
  }

  const body = await result.data.json();
  const encoder = new TextEncoder();
  const event = `data: ${JSON.stringify({ done: true, ...(body as object) })}\n\n`;

  const stream = new ReadableStream({
    start: (controller) => {
      controller.enqueue(encoder.encode(event));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

// =============================================================================
// Request handler
// =============================================================================
async function handleEndpointRequest(
  request: Request,
  endpointId: Hex,
  parameters: Record<string, string>,
  deps: PipelineDependencies
): Promise<Response> {
  const start = Date.now();

  const resolved = deps.endpointMap.get(endpointId);
  if (!resolved) {
    return jsonResponse({ error: 'Endpoint not found' }, 404);
  }

  // Reset plugin budgets per request so hooks don't degrade over time
  deps.plugins.resetBudgets();

  // Plugin: onHttpRequest
  const httpResult = await deps.plugins.callHttpRequest({
    endpointId,
    api: resolved.api.name,
    endpoint: resolved.endpoint.name,
    parameters,
  });
  if (httpResult?.reject) {
    return jsonResponse({ error: httpResult.message }, httpResult.status);
  }

  // Authenticate
  const auth = resolveAuth(resolved);
  const authResult = await authenticateRequest(request, auth);
  if (!authResult.authenticated) {
    if (isPaymentRequired(authResult)) {
      return jsonResponse(authResult.paymentDetails, 402);
    }
    return jsonResponse({ error: authResult.error }, 401);
  }

  // Validate required parameters
  const validationError = validateRequiredParameters(resolved, parameters);
  if (validationError) {
    return jsonResponse({ error: validationError }, 400);
  }

  // Check cache
  const maxAge = resolveCacheMaxAge(resolved);
  const cached = maxAge ? deps.cache.get(endpointId, parameters) : undefined;
  if (cached) {
    logger.debug(`Cache hit for ${resolved.api.name}/${resolved.endpoint.name}`);
    return jsonResponse(cached);
  }

  // Dispatch by endpoint mode
  if (resolved.endpoint.mode === 'stream') {
    return handleStreamingRequest(resolved, endpointId, parameters, deps);
  }

  if (resolved.endpoint.mode === 'async' && deps.asyncStore) {
    return handleAsyncRequest(resolved, endpointId, parameters, deps);
  }

  // Synchronous execution (mode === 'sync' or default)
  const logRequestId = keccak256(toHex(`${endpointId}${String(Date.now())}${String(Math.random())}`));

  const pipelineResult = await runWithContext({ requestId: logRequestId }, async () => {
    logger.info(`Processing ${resolved.api.name}/${resolved.endpoint.name}`);
    return go(() => executeApiCall(resolved, endpointId, parameters, deps));
  });

  if (!pipelineResult.success) {
    logger.error(`Pipeline failed for endpoint ${endpointId}: ${pipelineResult.error.message}`);
    void deps.plugins.callError({ error: pipelineResult.error, stage: 'pipeline', endpointId });
    return jsonResponse({ error: 'Internal processing error' }, 502);
  }

  const response = pipelineResult.data;

  // Cache successful responses
  if (maxAge && response.status === 200) {
    const body = await response.json();
    deps.cache.set(endpointId, parameters, body, maxAge);

    void deps.plugins.callResponseSent({
      endpointId,
      api: resolved.api.name,
      endpoint: resolved.endpoint.name,
      duration: Date.now() - start,
    });

    return jsonResponse(body);
  }

  if (response.status === 200) {
    void deps.plugins.callResponseSent({
      endpointId,
      api: resolved.api.name,
      endpoint: resolved.endpoint.name,
      duration: Date.now() - start,
    });
  }

  return response;
}

export { handleEndpointRequest };
export type { PipelineDependencies, RawResponseBody, SignedResponseBody };
