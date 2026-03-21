import { goSync } from '@api3/promise-utils';
import type { Hex } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import type { AsyncRequestStore } from './async';
import type { ResponseCache } from './cache';
import type { ResolvedEndpoint } from './endpoint';
import type { PipelineDependencies } from './pipeline';
import type { PluginRegistry } from './plugins';
import type { BeaconStore } from './push';
import { checkRateLimit } from './rate-limit';
import type { TokenBucket } from './rate-limit';
import type { Config } from './types';
import { VERSION } from './version';

// =============================================================================
// Types
// =============================================================================
interface ServerDependencies {
  readonly config: Config;
  readonly account: PrivateKeyAccount;
  readonly airnode: Hex;
  readonly endpointMap: ReadonlyMap<Hex, ResolvedEndpoint>;
  readonly plugins: PluginRegistry;
  readonly cache: ResponseCache;
  readonly beaconStore?: BeaconStore;
  readonly asyncStore?: AsyncRequestStore;
  readonly handleRequest: (
    request: Request,
    endpointId: Hex,
    parameters: Record<string, string>,
    deps: PipelineDependencies
  ) => Promise<Response>;
}

interface ServerHandle {
  readonly stop: () => void;
  readonly port: number;
  readonly hostname: string;
}

const MAX_BODY_BYTES = 64 * 1024;

// =============================================================================
// Response helpers
// =============================================================================
function jsonResponse(data: unknown, status = 200, corsOrigins = '*'): Response {
  return Response.json(data, {
    status,
    headers: { 'Access-Control-Allow-Origin': corsOrigins },
  });
}

function errorResponse(message: string, status: number, corsOrigins = '*'): Response {
  return jsonResponse({ error: message }, status, corsOrigins);
}

function parseEndpointRoute(pathname: string): Hex | undefined {
  const match = /^\/endpoints\/(0x[\da-fA-F]{64})$/.exec(pathname);
  if (!match) return undefined;
  return match[1] as Hex;
}

function parseBeaconRoute(pathname: string): Hex | undefined {
  const match = /^\/beacons\/(0x[\da-fA-F]{64})$/.exec(pathname);
  if (!match) return undefined;
  return match[1] as Hex;
}

function parseRequestRoute(pathname: string): string | undefined {
  const match = /^\/requests\/(0x[\da-fA-F]{64})$/.exec(pathname);
  if (!match) return undefined;
  return match[1];
}

// =============================================================================
// Request body parsing
// =============================================================================
async function parseRequestBody(request: Request): Promise<Record<string, string> | 'too_large' | 'bad_content_type'> {
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
  if (text.length > MAX_BODY_BYTES) return 'too_large';

  const result = goSync(() => JSON.parse(text) as { parameters?: Record<string, string> });
  if (!result.success) return {};
  return result.data.parameters ?? {};
}

function handlePreflight(corsOrigins: string): Response {
  return new Response(undefined, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': corsOrigins,
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
  const corsOrigins = deps.config.server.cors?.origins.join(', ') ?? '*';
  const rateLimitConfig = deps.config.server.rateLimit;
  const rateBuckets = new Map<string, TokenBucket>();

  const server = Bun.serve({
    port: deps.config.server.port,
    hostname: deps.config.server.host,
    fetch: async (request: Request, bunServer): Promise<Response> => {
      const url = new URL(request.url);

      if (request.method === 'OPTIONS') {
        return handlePreflight(corsOrigins);
      }

      if (rateLimitConfig) {
        const ip = bunServer.requestIP(request)?.address ?? 'unknown';
        const allowed = checkRateLimit(ip, rateBuckets, rateLimitConfig.window, rateLimitConfig.max);
        if (!allowed) {
          return errorResponse('Too Many Requests', 429, corsOrigins);
        }
      }

      if (url.pathname === '/health' && request.method === 'GET') {
        return jsonResponse({ status: 'ok', version: VERSION, airnode: deps.airnode }, 200, corsOrigins);
      }

      // Beacon routes (push data feeds)
      if (url.pathname === '/beacons' && request.method === 'GET' && deps.beaconStore) {
        const nowMs = Date.now();
        const delayed = deps.beaconStore
          .list()
          .filter((b) => b.delayMs === 0 || b.timestamp * 1000 + b.delayMs <= nowMs);
        return jsonResponse(delayed, 200, corsOrigins);
      }

      const beaconId = parseBeaconRoute(url.pathname);
      if (beaconId && request.method === 'GET') {
        if (!deps.beaconStore) {
          return errorResponse('Push not configured', 404, corsOrigins);
        }
        const beacon = deps.beaconStore.get(beaconId);
        if (!beacon) {
          return errorResponse('Beacon not found', 404, corsOrigins);
        }
        const nowMs = Date.now();
        if (beacon.delayMs > 0 && beacon.timestamp * 1000 + beacon.delayMs > nowMs) {
          return errorResponse('Data not yet available', 425, corsOrigins);
        }
        return jsonResponse(beacon, 200, corsOrigins);
      }

      // Async request polling
      const asyncRequestId = parseRequestRoute(url.pathname);
      if (asyncRequestId && request.method === 'GET' && deps.asyncStore) {
        const pending = deps.asyncStore.get(asyncRequestId);
        if (!pending) {
          return errorResponse('Request not found', 404, corsOrigins);
        }
        if (pending.status === 'complete') {
          return jsonResponse(
            { requestId: pending.requestId, status: 'complete', ...(pending.result as object) },
            200,
            corsOrigins
          );
        }
        if (pending.status === 'failed') {
          return jsonResponse(
            { requestId: pending.requestId, status: 'failed', error: pending.error },
            200,
            corsOrigins
          );
        }
        return jsonResponse(
          { requestId: pending.requestId, status: pending.status, pollUrl: `/requests/${pending.requestId}` },
          200,
          corsOrigins
        );
      }

      const endpointId = parseEndpointRoute(url.pathname);
      if (endpointId) {
        if (request.method !== 'POST') {
          return errorResponse('Method Not Allowed', 405, corsOrigins);
        }

        const body = await parseRequestBody(request);
        if (body === 'too_large') {
          return errorResponse('Request body too large', 413, corsOrigins);
        }
        if (body === 'bad_content_type') {
          return errorResponse('Content-Type must be application/json', 415, corsOrigins);
        }

        return deps.handleRequest(request, endpointId, body, deps);
      }

      return errorResponse('Not Found', 404, corsOrigins);
    },
  });

  return {
    stop: () => {
      void server.stop();
    },
    port: server.port ?? deps.config.server.port,
    hostname: server.hostname ?? deps.config.server.host,
  };
}

export { createServer, errorResponse, jsonResponse, MAX_BODY_BYTES };
export type { ServerDependencies, ServerHandle };
