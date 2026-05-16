import { go } from '@api3/promise-utils';
import { type Hex, bytesToHex, keccak256, toHex } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import { buildApiRequest, callApi } from './api/call';
import { processResponse } from './api/process';
import type { AsyncRequestStore } from './async';
import { authenticateRequest, isPaymentRequired } from './auth';
import type { ResponseCache } from './cache';
import type { ResolvedEndpoint } from './endpoint';
import { encryptResponse } from './fhe';
import { isNil } from './guards';
import { logger, runWithContext } from './logger';
import type { PluginRegistry, RequestPlugins } from './plugins';
import type { ReclaimProof } from './proof';
import { requestProof } from './proof';
import type { Semaphore } from './semaphore';
import { signResponse } from './sign';
import type { ClientAuth, Config, Encoding, Endpoint, Settings } from './types';

// =============================================================================
// Types
// =============================================================================
// What `createServer` holds and passes to `handleEndpointRequest`. `plugins` is
// the long-lived registry; the request handler mints a per-request session from
// it (see `RequestDependencies`).
interface PipelineDependencies {
  readonly account: PrivateKeyAccount;
  readonly airnode: Hex;
  readonly endpointMap: ReadonlyMap<Hex, ResolvedEndpoint>;
  readonly plugins: PluginRegistry;
  readonly cache: ResponseCache;
  readonly asyncStore?: AsyncRequestStore;
  readonly settings: Settings;
  // Same value as `config.server.rateLimit` — duplicated here so the pipeline
  // can read it (e.g. the x402 verification limit) without depending on the
  // whole Config shape.
  readonly rateLimit: Config['server']['rateLimit'];
  // Process-wide cap on concurrent upstream API calls (from `settings.maxConcurrentApiCalls`).
  readonly apiCallSemaphore: Semaphore;
}

// Request-scoped view: `plugins` is a single request's session, so its budgets
// are not shared with other in-flight requests. Every internal pipeline
// function takes this.
interface RequestDependencies extends Omit<PipelineDependencies, 'plugins'> {
  readonly plugins: RequestPlugins;
}

interface SignedResponseBody {
  readonly airnode: Hex;
  readonly endpointId: Hex;
  readonly timestamp: number;
  readonly data: Hex;
  readonly signature: Hex;
  readonly proof?: ReclaimProof;
}

interface RawResponseBody {
  readonly airnode: Hex;
  readonly endpointId: Hex;
  readonly timestamp: number;
  readonly rawData: unknown;
  readonly signature: Hex;
  readonly proof?: ReclaimProof;
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
async function buildSignedResponse(endpointId: Hex, data: Hex, deps: RequestDependencies): Promise<SignedResponseBody> {
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
  deps: RequestDependencies
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
// TLS proof
//
// We hand the gateway the exact request shape (URL, method, headers, cookies,
// body) that buildApiRequest produced, so the attested *request* matches what
// Airnode actually sent (requestProof additionally rejects a proof whose
// claim.parameters disagree). The attested *response*, though, comes from the
// gateway's own separate fetch and can differ from what Airnode signed for
// volatile data — a verifier comparing the two must account for that. Proof
// fetching is non-fatal: a gateway error, timeout, or a mismatched proof just
// omits the `proof` field.
// =============================================================================
async function fetchProofIfEnabled(
  resolved: ResolvedEndpoint,
  parameters: Record<string, string>,
  deps: RequestDependencies
): Promise<ReclaimProof | undefined> {
  const proof = deps.settings.proof;
  if (proof === 'none') return undefined;

  const responseMatches = resolved.endpoint.responseMatches;
  if (!responseMatches) {
    logger.debug('Skipping TLS proof — no responseMatches configured for this endpoint');
    return undefined;
  }

  const built = buildApiRequest(resolved.api, resolved.endpoint, parameters);

  const result = await go(() =>
    requestProof(
      proof.gatewayUrl,
      {
        url: built.url,
        method: built.method,
        headers: built.headers,
        body: built.body,
        responseMatches,
      },
      proof.timeout
    )
  );

  if (!result.success) {
    logger.warn(`TLS proof failed (non-fatal): ${result.error.message}`);
    return undefined;
  }

  return result.data;
}

// =============================================================================
// Encoding resolution
//
// Operator config drives encoding. A field set to the wildcard sentinel `'*'`
// explicitly delegates to the matching reserved request parameter (`_type`,
// `_path`, `_times`); a concrete value pins it and silently ignores anything
// the client sent for that field. There is no implicit "operator omitted it,
// so client may fill it in" path — the schema requires `type` and `path` to
// be present, and `times` is meaningful for numeric types only.
//
// Endpoints without any `encoding` block return raw JSON with a signature
// over the JSON hash; reserved params never synthesize an encoding out of
// nothing.
//
// Resolution can fail in two ways: the client failed to supply a value for a
// wildcard field (e.g. `type: '*'` but no `_type`), or the resolved value is
// otherwise malformed. Both surface as 400 to the requester rather than 500.
// =============================================================================
const RESERVED_PARAM_TYPE = '_type';
const RESERVED_PARAM_PATH = '_path';
const RESERVED_PARAM_TIMES = '_times';
const ENCODING_WILDCARD = '*';

interface ResolvedEncoding {
  readonly type: string;
  readonly path: string;
  readonly times?: string;
}

interface InvalidEncoding {
  readonly invalid: true;
  readonly message: string;
}

// Reserved encoding parameters are typed as strings but the request body's
// `parameters` values are not validated per-value (see server.ts), so a client
// could send `_type`/`_path`/`_times` as a non-string. Treat anything that
// isn't a string as absent rather than passing it to `processResponse`, which
// would call `.split()` on it and crash.
function reservedString(parameters: Record<string, string>, key: string): string | undefined {
  const value: unknown = parameters[key];
  return typeof value === 'string' ? value : undefined;
}

function resolveField(
  configValue: string | undefined,
  parameters: Record<string, string>,
  reservedKey: string
): { readonly value: string | undefined; readonly invalid?: string } {
  if (configValue === undefined) return { value: undefined };
  if (configValue !== ENCODING_WILDCARD) return { value: configValue };
  const supplied = reservedString(parameters, reservedKey);
  if (supplied === undefined || supplied === '') {
    return { value: undefined, invalid: `Endpoint requires \`${reservedKey}\` request parameter` };
  }
  return { value: supplied };
}

function resolveEncoding(
  configEncoding: Encoding | undefined,
  parameters: Record<string, string>
): ResolvedEncoding | InvalidEncoding | undefined {
  if (!configEncoding) return undefined;

  const type = resolveField(configEncoding.type, parameters, RESERVED_PARAM_TYPE);
  if (type.invalid) return { invalid: true, message: type.invalid };

  const path = resolveField(configEncoding.path, parameters, RESERVED_PARAM_PATH);
  if (path.invalid) return { invalid: true, message: path.invalid };

  const times = resolveField(configEncoding.times, parameters, RESERVED_PARAM_TIMES);
  if (times.invalid) return { invalid: true, message: times.invalid };

  if (!type.value || !path.value) {
    return { invalid: true, message: 'Endpoint encoding is incomplete' };
  }

  return times.value
    ? { type: type.value, path: path.value, times: times.value }
    : { type: type.value, path: path.value };
}

// =============================================================================
// FHE encryption
//
// When an endpoint is configured with `encrypt`, the ABI-encoded value is
// replaced with an FHE ciphertext before signing — and before onBeforeSign
// plugins run, so plugins observe the ciphertext, not the plaintext. The
// relayer connection comes from `settings.fhe`; the config schema guarantees it
// is not `'none'` whenever an endpoint opts in, but we re-check defensively.
// See `src/fhe.ts`.
// =============================================================================
async function prepareSignableData(
  endpoint: Endpoint,
  encoding: ResolvedEncoding,
  encodedData: Hex,
  deps: RequestDependencies
): Promise<Hex> {
  if (!endpoint.encrypt) return encodedData;

  const fhe = deps.settings.fhe;
  if (fhe === 'none') {
    throw new Error('Endpoint requires FHE encryption but settings.fhe is not configured');
  }
  return encryptResponse(fhe, endpoint.encrypt, encodedData, encoding.type);
}

// =============================================================================
// API call pipeline
// =============================================================================
async function executeApiCall(
  resolved: ResolvedEndpoint,
  requestId: Hex,
  endpointId: Hex,
  parameters: Record<string, string>,
  deps: RequestDependencies
): Promise<Response> {
  const beforeResult = await deps.plugins.callBeforeApiCall({
    requestId,
    endpointId,
    api: resolved.api.name,
    endpoint: resolved.endpoint.name,
    parameters,
  });
  if (beforeResult.dropped) {
    return jsonResponse({ error: 'Request dropped by plugin' }, 403);
  }

  const resolvedParameters = beforeResult.parameters;

  // Bound concurrent upstream calls process-wide. If no slot opens up within the
  // endpoint's own timeout window, the request would have timed out anyway — fail
  // fast with 503 rather than queue indefinitely.
  const slot = await deps.apiCallSemaphore.acquire(resolved.api.timeout);
  if (!slot) {
    logger.warn(`Upstream-call concurrency limit reached; rejecting request for endpoint ${endpointId}`);
    void deps.plugins.callError({
      requestId,
      error: new Error('Upstream-call concurrency limit reached'),
      stage: 'apiCall',
      endpointId,
    });
    return jsonResponse({ error: 'Server busy — too many upstream calls in flight' }, 503);
  }
  const apiResult = await go(() => callApi(resolved.api, resolved.endpoint, resolvedParameters));
  slot(); // release the slot before any conditional return below

  if (!apiResult.success) {
    logger.error(`API call failed for endpoint ${endpointId}: ${apiResult.error.message}`);
    void deps.plugins.callError({ requestId, error: apiResult.error, stage: 'apiCall', endpointId });
    return jsonResponse({ error: 'API call failed' }, 502);
  }

  const afterResult = await deps.plugins.callAfterApiCall({
    requestId,
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

  // Resolve encoding: operator-pinned fields win; `*` fields take the matching request reserved param
  const encoding = resolveEncoding(resolved.endpoint.encoding, resolvedParameters);
  if (encoding && 'invalid' in encoding) {
    return jsonResponse({ error: encoding.message }, 400);
  }

  if (encoding) {
    if (isNil(apiResponse.data)) {
      return jsonResponse({ error: 'API returned no data to encode' }, 502);
    }

    const encodedData = processResponse(apiResponse.data, encoding);

    const prepared = await go(() => prepareSignableData(resolved.endpoint, encoding, encodedData, deps));
    if (!prepared.success) {
      logger.error(`FHE encryption failed for endpoint ${endpointId}: ${prepared.error.message}`);
      void deps.plugins.callError({ requestId, error: prepared.error, stage: 'encryption', endpointId });
      return jsonResponse({ error: 'FHE encryption failed' }, 502);
    }

    const signResult = await deps.plugins.callBeforeSign({
      requestId,
      endpointId,
      api: resolved.api.name,
      endpoint: resolved.endpoint.name,
      data: prepared.data,
    });
    if (signResult.dropped) {
      return jsonResponse({ error: 'Request dropped by plugin' }, 403);
    }

    const proof = await fetchProofIfEnabled(resolved, resolvedParameters, deps);
    const responseBody = await buildSignedResponse(endpointId, signResult.data, deps);
    return jsonResponse(proof ? { ...responseBody, proof } : responseBody);
  }

  const proof = await fetchProofIfEnabled(resolved, resolvedParameters, deps);
  const responseBody = await buildRawResponse(endpointId, apiResponse.data, deps);
  return jsonResponse(proof ? { ...responseBody, proof } : responseBody);
}

// =============================================================================
// Async request handler
// =============================================================================
function handleAsyncRequest(
  resolved: ResolvedEndpoint,
  endpointId: Hex,
  parameters: Record<string, string>,
  deps: RequestDependencies
): Response {
  const store = deps.asyncStore;
  if (!store) return jsonResponse({ error: 'Async not configured' }, 500);

  const pending = store.create();
  if (!pending) {
    return jsonResponse({ error: 'Too many pending requests' }, 503);
  }

  const requestId = pending.requestId;

  // Process in background. Wrap in logger context so async-mode logs carry
  // the requestId just like sync-mode, and route plugin-observable errors
  // through callError so heartbeat/alerting plugins see async failures.
  void runWithContext({ requestId }, async () => {
    store.setProcessing(requestId);
    const result = await go(() => executeApiCall(resolved, requestId, endpointId, parameters, deps));
    if (!result.success) {
      logger.error(`Async pipeline failed for endpoint ${endpointId}: ${result.error.message}`);
      void deps.plugins.callError({ requestId, error: result.error, stage: 'pipeline', endpointId });
      store.setFailed(requestId, 'Pipeline execution failed');
      return;
    }
    if (result.data.status !== 200) {
      const statusError = new Error(`Upstream returned status ${String(result.data.status)}`);
      void deps.plugins.callError({ requestId, error: statusError, stage: 'api-call', endpointId });
      store.setFailed(pending.requestId, 'API call returned an error');
      return;
    }
    const body = await result.data.json();
    store.setComplete(pending.requestId, body);
  });

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
// Runs the full pipeline (plugins included) via executeApiCall — inside the
// same logger context and with the same onError/onResponseSent hooks as the
// sync path — then wraps the signed result in a single SSE event. A non-200
// pipeline outcome (plugin drop, bad encoding, upstream error) is propagated as
// the plain HTTP error response, not a 200 SSE frame carrying an error payload.
// Real incremental streaming (proxying chunked upstream responses) requires the
// upstream API to support it — a future enhancement. The streaming path does
// not use the response cache.
// =============================================================================
async function handleStreamingRequest(
  resolved: ResolvedEndpoint,
  requestId: Hex,
  endpointId: Hex,
  parameters: Record<string, string>,
  deps: RequestDependencies,
  start: number
): Promise<Response> {
  const result = await runWithContext({ requestId }, async () => {
    logger.info(`Processing ${resolved.api.name}/${resolved.endpoint.name} (stream)`);
    return go(() => executeApiCall(resolved, requestId, endpointId, parameters, deps));
  });
  if (!result.success) {
    logger.error(`Streaming pipeline failed for endpoint ${endpointId}: ${result.error.message}`);
    void deps.plugins.callError({ requestId, error: result.error, stage: 'pipeline', endpointId });
    return jsonResponse({ error: 'Internal processing error' }, 502);
  }
  if (result.data.status !== 200) {
    return result.data;
  }

  const body = await result.data.json();
  void deps.plugins.callResponseSent({
    requestId,
    endpointId,
    api: resolved.api.name,
    endpoint: resolved.endpoint.name,
    duration: Date.now() - start,
  });

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
  deps: PipelineDependencies,
  clientIp: string = 'unknown'
): Promise<Response> {
  const start = Date.now();

  const resolved = deps.endpointMap.get(endpointId);
  if (!resolved) {
    return jsonResponse({ error: 'Endpoint not found' }, 404);
  }

  // Per-request correlation ID — threaded into every plugin hook and logger
  // context so plugins can key per-request state (instead of relying on
  // endpointId, which races when multiple clients hit the same endpoint).
  const requestId: Hex = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));

  // Mint a per-request plugin session. Its budgets are private to this request,
  // so concurrent requests can't consume each other's allowance.
  const plugins = deps.plugins.beginRequest();
  const rdeps: RequestDependencies = { ...deps, plugins };

  // Plugin: onHttpRequest
  const httpResult = await plugins.callHttpRequest({
    requestId,
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
  const authResult = await authenticateRequest(
    request,
    { airnode: deps.airnode, endpointId, clientIp, x402RateLimit: deps.rateLimit.x402 },
    auth
  );
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

  // Dispatch by endpoint mode. The response cache is used by sync mode only —
  // async returns a 202+pollUrl and stream returns an SSE frame, so serving a
  // plain cached JSON body there would break the response contract for that
  // mode. (Those modes don't populate the cache either.)
  if (resolved.endpoint.mode === 'stream') {
    return handleStreamingRequest(resolved, requestId, endpointId, parameters, rdeps, start);
  }

  if (resolved.endpoint.mode === 'async' && deps.asyncStore) {
    return handleAsyncRequest(resolved, endpointId, parameters, rdeps);
  }

  // Check cache (sync mode)
  const maxAge = resolveCacheMaxAge(resolved);
  const cached = maxAge ? deps.cache.get(endpointId, parameters) : undefined;
  if (cached) {
    logger.debug(`Cache hit for ${resolved.api.name}/${resolved.endpoint.name}`);
    void plugins.callResponseSent({
      requestId,
      endpointId,
      api: resolved.api.name,
      endpoint: resolved.endpoint.name,
      duration: Date.now() - start,
    });
    return jsonResponse(cached);
  }

  // Synchronous execution (mode === 'sync' or default)
  const pipelineResult = await runWithContext({ requestId }, async () => {
    logger.info(`Processing ${resolved.api.name}/${resolved.endpoint.name}`);
    return go(() => executeApiCall(resolved, requestId, endpointId, parameters, rdeps));
  });

  if (!pipelineResult.success) {
    logger.error(`Pipeline failed for endpoint ${endpointId}: ${pipelineResult.error.message}`);
    void plugins.callError({ requestId, error: pipelineResult.error, stage: 'pipeline', endpointId });
    return jsonResponse({ error: 'Internal processing error' }, 502);
  }

  const response = pipelineResult.data;

  // Cache successful responses
  if (maxAge && response.status === 200) {
    const body = await response.json();
    deps.cache.set(endpointId, parameters, body, maxAge);

    void plugins.callResponseSent({
      requestId,
      endpointId,
      api: resolved.api.name,
      endpoint: resolved.endpoint.name,
      duration: Date.now() - start,
    });

    return jsonResponse(body);
  }

  if (response.status === 200) {
    void plugins.callResponseSent({
      requestId,
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
