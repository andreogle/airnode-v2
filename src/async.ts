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
const REQUEST_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING = 100;

function createAsyncRequestStore(): AsyncRequestStore {
  const store = createBoundedMap<string, PendingRequest>({
    maxEntries: MAX_PENDING,
    sweepIntervalMs: 60_000,
    shouldEvict: (req) => Date.now() > req.createdAt + REQUEST_TTL_MS,
  });

  return {
    create: (_endpointId) => {
      if (store.size() >= MAX_PENDING) return;
      const requestId: Hex = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
      const entry: PendingRequest = { requestId, status: 'pending', createdAt: Date.now() };
      store.set(requestId, entry);
      return entry;
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
    },

    setFailed: (requestId, error) => {
      const entry = store.get(requestId);
      if (!entry) return;
      entry.status = 'failed'; // eslint-disable-line functional/immutable-data
      entry.error = error; // eslint-disable-line functional/immutable-data
    },

    stop: () => {
      store.stop();
    },
  };
}

export { createAsyncRequestStore };
export type { AsyncRequestStore, PendingRequest, RequestStatus };
