import { createHash, timingSafeEqual } from 'node:crypto';
import { go, goSync } from '@api3/promise-utils';
import type { Hex } from 'viem';
import { authenticateRequest, isPaymentRequired } from './auth';
import { createBoundedMap } from './bounded-map';
import type { SignedBeaconData } from './push';
import { checkRateLimit } from './rate-limit';
import type { TokenBucket } from './rate-limit';
import { errorResponse, jsonResponse } from './server';
import { deriveBeaconId, verifySignedBeacon } from './sign';
import type { CacheServerConfig } from './types';
import { VERSION } from './version';

// =============================================================================
// Types
// =============================================================================
interface CacheServerDependencies {
  readonly config: CacheServerConfig;
}

interface CacheServerHandle {
  readonly stop: () => void;
  readonly port: number;
  readonly hostname: string;
  readonly store: BeaconIngestionStore;
}

// =============================================================================
// Beacon ingestion store
//
// In-memory store keyed by beaconId. Only the latest value per beacon is kept.
// setIfNewer ensures that out-of-order arrivals don't overwrite fresh data.
// Bounded to 100k entries with 24-hour eviction to prevent unbounded growth.
// =============================================================================
const MAX_BEACON_ENTRIES = 100_000;
const BEACON_SWEEP_INTERVAL_MS = 60_000;
const BEACON_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface BeaconIngestionStore {
  readonly get: (beaconId: Hex) => SignedBeaconData | undefined;
  readonly list: () => readonly SignedBeaconData[];
  readonly setIfNewer: (beaconId: Hex, data: SignedBeaconData) => boolean;
  readonly size: () => number;
  readonly stop: () => void;
}

function createBeaconIngestionStore(): BeaconIngestionStore {
  const store = createBoundedMap<Hex, SignedBeaconData>({
    maxEntries: MAX_BEACON_ENTRIES,
    sweepIntervalMs: BEACON_SWEEP_INTERVAL_MS,
    shouldEvict: (entry) => Date.now() - entry.timestamp * 1000 > BEACON_MAX_AGE_MS,
  });

  return {
    get: (beaconId) => store.get(beaconId),
    list: () => store.values(),
    setIfNewer: (beaconId, data) => {
      const existing = store.get(beaconId);
      if (existing && existing.timestamp >= data.timestamp) return false;
      store.set(beaconId, data);
      return true;
    },
    size: () => store.size(),
    stop: () => {
      store.stop();
    },
  };
}

// =============================================================================
// Push authentication (bearer token from airnode → cache server)
//
// Every push request must come from an explicitly allowed airnode address
// with a matching auth token. There is no wildcard mode — the cache server
// operator must declare which airnodes are trusted.
// =============================================================================
function authenticatePush(
  request: Request,
  airnodeAddress: string,
  allowedAirnodes: CacheServerConfig['allowedAirnodes']
): string | undefined {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return 'Missing or invalid Authorization header';

  const token = authHeader.slice(7);
  if (token.length === 0) return 'Empty bearer token';

  const allowed = allowedAirnodes.find((a) => a.address.toLowerCase() === airnodeAddress.toLowerCase());
  if (!allowed) return 'Airnode not in allowedAirnodes list';

  const ha = createHash('sha256').update(token).digest();
  const hb = createHash('sha256').update(allowed.authToken).digest();
  if (!timingSafeEqual(ha, hb)) return 'Invalid auth token';

  return undefined;
}

// =============================================================================
// Beacon validation and ingestion
//
// Processes all items in the batch, collecting errors per-item rather than
// failing the entire batch on the first invalid item.
// =============================================================================
interface IngestResult {
  readonly count: number;
  readonly skipped: number;
  readonly errors: number;
}

async function ingestBeacons(
  items: readonly Record<string, unknown>[],
  airnodeAddress: Hex,
  store: BeaconIngestionStore
): Promise<IngestResult> {
  // eslint-disable-next-line functional/no-let
  let count = 0;
  // eslint-disable-next-line functional/no-let
  let skipped = 0;
  // eslint-disable-next-line functional/no-let
  let errors = 0;

  // eslint-disable-next-line functional/no-loop-statements
  for (const item of items) {
    const endpointId = item['endpointId'] as Hex | undefined;
    const timestamp = item['timestamp'] as number | undefined;
    const data = item['data'] as Hex | undefined;
    const signature = item['signature'] as Hex | undefined;

    if (!endpointId || !timestamp || !data || !signature) {
      errors++;
      continue;
    }

    const recovered = await verifySignedBeacon(endpointId, timestamp, data, signature);
    if (!recovered || recovered.toLowerCase() !== airnodeAddress.toLowerCase()) {
      errors++;
      continue;
    }

    const beaconId = deriveBeaconId(airnodeAddress, endpointId);
    const beacon: SignedBeaconData = {
      airnode: airnodeAddress,
      endpointId,
      beaconId,
      timestamp,
      data,
      signature,
      delayMs: 0,
    };

    if (store.setIfNewer(beaconId, beacon)) {
      count++;
    } else {
      skipped++;
    }
  }

  return { count, skipped, errors };
}

// =============================================================================
// Route parsing
// =============================================================================
const BEACONS_ROUTE = /^\/beacons\/(0x[\da-fA-F]{40})$/;
const BEACON_ID_PATTERN = /^0x[\da-fA-F]{64}$/;
const MAX_BODY_BYTES = 512 * 1024;

function parseBeaconsRoute(pathname: string): Hex | undefined {
  const match = BEACONS_ROUTE.exec(pathname);
  if (!match) return undefined;
  return match[1] as Hex;
}

function findEndpoint(
  pathname: string,
  endpoints: CacheServerConfig['endpoints']
): { endpoint: CacheServerConfig['endpoints'][0]; rest: string } | undefined {
  // Sort by path length descending for longest-match-first routing
  const sorted = endpoints.toSorted((a, b) => b.path.length - a.path.length);
  // eslint-disable-next-line functional/no-loop-statements
  for (const endpoint of sorted) {
    if (pathname === endpoint.path) return { endpoint, rest: '' };
    if (pathname.startsWith(`${endpoint.path}/`)) {
      return { endpoint, rest: pathname.slice(endpoint.path.length + 1) };
    }
  }
  return undefined;
}

// =============================================================================
// Server factory
// =============================================================================
function createCacheServer(deps: CacheServerDependencies): CacheServerHandle {
  const { config } = deps;
  const corsOrigins = config.server.cors?.origins.join(', ') ?? '*';
  const rateLimitConfig = config.server.rateLimit;
  const rateBuckets = new Map<string, TokenBucket>();
  const store = createBeaconIngestionStore();

  const handlePreflight = (): Response =>
    new Response(undefined, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': corsOrigins,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Api-Key',
        'Access-Control-Max-Age': '86400',
      },
    });

  const server = Bun.serve({
    port: config.server.port,
    hostname: config.server.host,
    fetch: async (request: Request, bunServer): Promise<Response> => {
      const url = new URL(request.url);

      if (request.method === 'OPTIONS') return handlePreflight();

      if (rateLimitConfig) {
        const ip = bunServer.requestIP(request)?.address ?? 'unknown';
        if (!checkRateLimit(ip, rateBuckets, rateLimitConfig.window, rateLimitConfig.max)) {
          return errorResponse('Too Many Requests', 429, corsOrigins);
        }
      }

      // GET /health
      if (url.pathname === '/health' && request.method === 'GET') {
        return jsonResponse({ status: 'ok', version: VERSION }, 200, corsOrigins);
      }

      // POST /beacons/{airnodeAddress} — ingest signed beacons
      const airnodeAddress = parseBeaconsRoute(url.pathname);
      if (airnodeAddress && request.method === 'POST') {
        const authError = authenticatePush(request, airnodeAddress, config.allowedAirnodes);
        if (authError) return errorResponse(authError, 401, corsOrigins);

        const contentLength = request.headers.get('Content-Length');
        if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
          return errorResponse('Request body too large', 413, corsOrigins);
        }

        const textResult = await go(() => request.text());
        if (!textResult.success) return errorResponse('Bad Request', 400, corsOrigins);
        if (textResult.data.length > MAX_BODY_BYTES) return errorResponse('Request body too large', 413, corsOrigins);

        const parseResult = goSync(() => JSON.parse(textResult.data) as unknown);
        if (!parseResult.success) return errorResponse('Invalid JSON', 400, corsOrigins);

        const payload = parseResult.data;
        const items: readonly Record<string, unknown>[] = Array.isArray(payload)
          ? (payload as Record<string, unknown>[])
          : [payload as Record<string, unknown>];

        if (items.length === 0) return errorResponse('Empty payload', 400, corsOrigins);

        const result = await ingestBeacons(items, airnodeAddress, store);
        return jsonResponse(result, 200, corsOrigins);
      }

      // GET /{endpointPath}/{beaconId} or GET /{endpointPath} — serve beacons
      const match = findEndpoint(url.pathname, config.endpoints);
      if (match && request.method === 'GET') {
        const authResult = await authenticateRequest(request, match.endpoint.auth);
        if (!authResult.authenticated) {
          if (isPaymentRequired(authResult)) {
            return jsonResponse(authResult.paymentDetails, 402, corsOrigins);
          }
          return errorResponse(authResult.error, 401, corsOrigins);
        }

        const nowSeconds = Math.floor(Date.now() / 1000);
        const { delaySeconds } = match.endpoint;

        // GET /{endpointPath}/{beaconId}
        if (match.rest && BEACON_ID_PATTERN.test(match.rest)) {
          const beaconId = match.rest as Hex;
          const beacon = store.get(beaconId);
          if (!beacon) return errorResponse('Beacon not found', 404, corsOrigins);

          if (delaySeconds > 0 && beacon.timestamp + delaySeconds > nowSeconds) {
            return errorResponse('Data not yet available', 425, corsOrigins);
          }

          return jsonResponse(beacon, 200, corsOrigins);
        }

        // GET /{endpointPath} — list all beacons with delay filtering
        if (!match.rest) {
          const beacons = store.list().filter((b) => delaySeconds === 0 || b.timestamp + delaySeconds <= nowSeconds);
          return jsonResponse(beacons, 200, corsOrigins);
        }
      }

      return errorResponse('Not Found', 404, corsOrigins);
    },
  });

  return {
    stop: () => {
      store.stop();
      void server.stop();
    },
    port: server.port ?? config.server.port,
    hostname: server.hostname ?? config.server.host,
    store,
  };
}

export { createCacheServer, createBeaconIngestionStore };
export type { BeaconIngestionStore, CacheServerDependencies, CacheServerHandle };
