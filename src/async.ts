import { type Hex, bytesToHex } from 'viem';
import { createBoundedMap } from './bounded-map';

// =============================================================================
// Types
// =============================================================================
type RequestStatus = 'pending' | 'processing' | 'complete' | 'failed';

interface PendingRequest {
  readonly requestId: Hex;
  status: RequestStatus;
  result?: unknown;
  error?: string;
  readonly createdAt: number;
  // Set when the request reaches `complete`/`failed`. Finished entries are kept
  // only briefly (FINISHED_TTL_MS) so the client can poll the result, then
  // evicted — they must not hold an admission slot for the full request TTL.
  finishedAt?: number;
}

interface AsyncRequestStore {
  readonly create: (endpointId: Hex) => PendingRequest | undefined;
  readonly get: (requestId: string) => PendingRequest | undefined;
  readonly setProcessing: (requestId: Hex) => void;
  readonly setComplete: (requestId: Hex, result: unknown) => void;
  readonly setFailed: (requestId: Hex, error: string) => void;
  readonly stop: () => void;
}

// =============================================================================
// Store factory
// =============================================================================
const REQUEST_TTL_MS = 10 * 60 * 1000; // max lifetime of a still-running request
const FINISHED_TTL_MS = 60 * 1000; // how long a finished result is retained for polling
const MAX_PENDING = 100;

function isExpired(req: PendingRequest): boolean {
  if (req.finishedAt !== undefined) return Date.now() > req.finishedAt + FINISHED_TTL_MS;
  return Date.now() > req.createdAt + REQUEST_TTL_MS;
}

function createAsyncRequestStore(): AsyncRequestStore {
  const store = createBoundedMap<string, PendingRequest>({
    maxEntries: MAX_PENDING,
    sweepIntervalMs: 60_000,
    shouldEvict: isExpired,
    // When full, the oldest entry is FIFO-evicted only if it is safe to drop
    // (a finished result past its retention window, or a stalled request past
    // its TTL); otherwise the new request is refused with 503.
    refuseEvictionIf: (req) => !isExpired(req),
  });

  return {
    create: (_endpointId) => {
      const requestId: Hex = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
      const entry: PendingRequest = { requestId, status: 'pending', createdAt: Date.now() };
      return store.set(requestId, entry) ? entry : undefined;
    },

    get: (requestId) => store.get(requestId),

    setProcessing: (requestId) => {
      const entry = store.get(requestId);
      if (entry) entry.status = 'processing'; // eslint-disable-line functional/immutable-data
    },

    setComplete: (requestId, result) => {
      const entry = store.get(requestId);
      if (!entry) return;
      entry.status = 'complete'; // eslint-disable-line functional/immutable-data
      entry.result = result; // eslint-disable-line functional/immutable-data
      entry.finishedAt = Date.now(); // eslint-disable-line functional/immutable-data
    },

    setFailed: (requestId, error) => {
      const entry = store.get(requestId);
      if (!entry) return;
      entry.status = 'failed'; // eslint-disable-line functional/immutable-data
      entry.error = error; // eslint-disable-line functional/immutable-data
      entry.finishedAt = Date.now(); // eslint-disable-line functional/immutable-data
    },

    stop: () => {
      store.stop();
    },
  };
}

export { createAsyncRequestStore };
export type { AsyncRequestStore, PendingRequest, RequestStatus };
