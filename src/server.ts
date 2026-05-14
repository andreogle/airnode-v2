import { goSync } from '@api3/promise-utils';
import type { Hex } from 'viem';
import { logger } from './logger';
import type { PipelineDependencies } from './pipeline';
import { checkRateLimit } from './rate-limit';
import type { TokenBucket } from './rate-limit';
import type { Config } from './types';

// =============================================================================
// Types
// =============================================================================
interface ServerDependencies extends PipelineDependencies {
  readonly config: Config;
  readonly handleRequest: (
    request: Request,
    endpointId: Hex,
    parameters: Record<string, string>,
    deps: PipelineDependencies,
    clientIp: string
  ) => Promise<Response>;
}

interface ServerHandle {
  // Stops accepting new connections and resolves once in-flight requests have
  // finished (graceful drain). Use `stop(true)`-style force-close is not exposed.
  readonly stop: () => Promise<void>;
  readonly port: number;
  readonly hostname: string;
}

const MAX_BODY_BYTES = 64 * 1024;

// =============================================================================
// CORS
//
// When no allow-list is configured, emit `Access-Control-Allow-Origin: *` so
// public endpoints work from any origin. When an allow-list is configured,
// reflect the request's `Origin` header only if it matches the list — never
// concatenate multiple origins into a single header, since that is invalid
// CORS syntax and browsers reject it. `Vary: Origin` signals caches that the
// response depends on the requesting origin.
// =============================================================================
interface CorsHeaders {
  readonly 'Access-Control-Allow-Origin': string;
  readonly Vary?: string;
}

const DEFAULT_CORS: CorsHeaders = { 'Access-Control-Allow-Origin': '*' };

function resolveCorsHeaders(request: Request, allowedOrigins: readonly string[] | undefined): CorsHeaders {
  if (!allowedOrigins || allowedOrigins.length === 0 || allowedOrigins.includes('*')) {
    return DEFAULT_CORS;
  }
  const requestOrigin = request.headers.get('Origin');
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    return { 'Access-Control-Allow-Origin': requestOrigin, Vary: 'Origin' };
  }
  return { 'Access-Control-Allow-Origin': 'null', Vary: 'Origin' };
}

// =============================================================================
// Response helpers
// =============================================================================
function jsonResponse(data: unknown, status = 200, cors: CorsHeaders = DEFAULT_CORS): Response {
  return Response.json(data, { status, headers: { ...cors } });
}

function errorResponse(message: string, status: number, cors: CorsHeaders = DEFAULT_CORS): Response {
  return jsonResponse({ error: message }, status, cors);
}

function parseEndpointRoute(pathname: string): Hex | undefined {
  const match = /^\/endpoints\/(0x[\da-fA-F]{64})$/.exec(pathname);
  if (!match) return undefined;
  return match[1] as Hex;
}

function parseRequestRoute(pathname: string): string | undefined {
  const match = /^\/requests\/(0x[\da-fA-F]{64})$/.exec(pathname);
  if (!match) return undefined;
  return match[1];
}

// Rate-limit key. By default the socket peer's address; when `trustForwardedFor`
// is set (Airnode behind a trusted reverse proxy), the first `X-Forwarded-For`
// entry — the originating client — instead.
function resolveClientIp(request: Request, peerAddress: string | undefined, trustForwardedFor: boolean): string {
  if (trustForwardedFor) {
    const forwarded = request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  return peerAddress ?? 'unknown';
}

// =============================================================================
// Request body parsing
// =============================================================================
type ParsedBody = Record<string, string> | 'too_large' | 'bad_content_type' | 'bad_parameters';

// The request body must be `{ parameters: { ... } }` — `parameters`, when
// present, must be a plain object. We do NOT validate or coerce the individual
// values here: a `body`-typed parameter may legitimately be nested JSON (it is
// serialized whole into the upstream request body), while query/path/header/
// cookie parameters are coerced to strings further down in `buildApiRequest`.
// See the limitation note in book/docs/config/apis.md ("Parameter values").
function extractRequestParameters(body: unknown): Record<string, string> | 'bad_parameters' {
  if (body === null || body === undefined) return {};
  if (typeof body !== 'object' || Array.isArray(body)) return 'bad_parameters';
  const raw = (body as { parameters?: unknown }).parameters;
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return 'bad_parameters';
  // Values stay untyped; the pipeline handles each parameter by its `in` kind.
  return raw as Record<string, string>;
}

async function parseRequestBody(request: Request): Promise<ParsedBody> {
  const contentType = request.headers.get('Content-Type');
  if (contentType && !contentType.includes('application/json')) {
    return 'bad_content_type';
  }

  const contentLength = request.headers.get('Content-Length');
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    return 'too_large';
  }

  const text = await request.text();
  if (!text) return {};
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return 'too_large';

  const result = goSync(() => JSON.parse(text) as unknown);
  if (!result.success) return {};
  return extractRequestParameters(result.data);
}

function withCorsHeaders(response: Response, cors: CorsHeaders): Response {
  const headers = new Headers(response.headers);
  // eslint-disable-next-line functional/no-loop-statements
  for (const [key, value] of Object.entries(cors)) {
    if (typeof value === 'string') headers.set(key, value);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function handlePreflight(cors: CorsHeaders): Response {
  return new Response(undefined, {
    status: 204,
    headers: {
      ...cors,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key, Authorization, X-Payment-Proof',
      'Access-Control-Max-Age': '86400',
    },
  });
}

// =============================================================================
// Server factory
// =============================================================================
function createServer(deps: ServerDependencies): ServerHandle {
  const allowedOrigins = deps.config.server.cors?.origins;
  const rateLimitConfig = deps.config.server.rateLimit;
  const rateBuckets = new Map<string, TokenBucket>();

  // The routing core. `fetch` wraps it to emit one access-log line per request.
  async function route(
    request: Request,
    url: URL,
    cors: CorsHeaders,
    peerAddress: string | undefined
  ): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return handlePreflight(cors);
    }

    const ip = resolveClientIp(request, peerAddress, rateLimitConfig.trustForwardedFor);
    if (!checkRateLimit(ip, rateBuckets, rateLimitConfig.window, rateLimitConfig.max)) {
      return errorResponse('Too Many Requests', 429, cors);
    }

    if (url.pathname === '/health' && request.method === 'GET') {
      // Deliberately no version field — don't volunteer build info on an
      // unauthenticated endpoint. The airnode address (the actual identity) is
      // useful for "is this the airnode I expect?" and is public anyway.
      return jsonResponse({ status: 'ok', airnode: deps.airnode }, 200, cors);
    }

    // Async request polling
    const asyncRequestId = parseRequestRoute(url.pathname);
    if (asyncRequestId && request.method === 'GET' && deps.asyncStore) {
      const pending = deps.asyncStore.get(asyncRequestId);
      if (!pending) {
        return errorResponse('Request not found', 404, cors);
      }
      if (pending.status === 'complete') {
        return jsonResponse(
          { requestId: pending.requestId, status: 'complete', ...(pending.result as object) },
          200,
          cors
        );
      }
      if (pending.status === 'failed') {
        return jsonResponse({ requestId: pending.requestId, status: 'failed', error: pending.error }, 200, cors);
      }
      return jsonResponse(
        { requestId: pending.requestId, status: pending.status, pollUrl: `/requests/${pending.requestId}` },
        200,
        cors
      );
    }

    const endpointId = parseEndpointRoute(url.pathname);
    if (endpointId) {
      if (request.method !== 'POST') {
        return errorResponse('Method Not Allowed', 405, cors);
      }

      const body = await parseRequestBody(request);
      if (body === 'too_large') {
        return errorResponse('Request body too large', 413, cors);
      }
      if (body === 'bad_content_type') {
        return errorResponse('Content-Type must be application/json', 415, cors);
      }
      if (body === 'bad_parameters') {
        return errorResponse('Request "parameters" must be an object', 400, cors);
      }

      return withCorsHeaders(await deps.handleRequest(request, endpointId, body, deps, ip), cors);
    }

    return errorResponse('Not Found', 404, cors);
  }

  // Connection idle timeout (seconds, Bun caps it at 255). Set it explicitly,
  // and high enough that a legitimate request waiting on a slow upstream + TLS
  // proof isn't killed mid-flight, while still bounding connections that just
  // sit there. Worst-case wait ≈ upstream timeout + proof timeout + overhead.
  const proofTimeoutMs = deps.settings.proof === 'none' ? 0 : deps.settings.proof.timeout;
  const idleTimeout = Math.min(255, Math.ceil((deps.settings.timeout + proofTimeoutMs) / 1000) + 20);

  const server = Bun.serve({
    port: deps.config.server.port,
    hostname: deps.config.server.host,
    idleTimeout,
    fetch: async (request: Request, bunServer): Promise<Response> => {
      const start = Date.now();
      const url = new URL(request.url);
      const cors = resolveCorsHeaders(request, allowedOrigins);
      const response = await route(request, url, cors, bunServer.requestIP(request)?.address);
      logger.info(`${request.method} ${url.pathname} ${String(response.status)} ${String(Date.now() - start)}ms`);
      return response;
    },
  });

  return {
    stop: () => server.stop(false),
    port: server.port ?? deps.config.server.port,
    hostname: server.hostname ?? deps.config.server.host,
  };
}

export { createServer, errorResponse, jsonResponse, MAX_BODY_BYTES };
export type { ServerDependencies, ServerHandle };
