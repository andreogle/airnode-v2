import type { Hex } from 'viem';
import { keccak256, toHex } from 'viem';
import { createBoundedMap } from './bounded-map';

// =============================================================================
// Types
// =============================================================================
type RequestStatus = 'pending' | 'processing' | 'complete' | 'failed';

interface PendingRequest {
  readonly requestId: string;
  status: RequestStatus;
  result?: unknown;
  error?: string;
  readonly createdAt: number;
}

interface AsyncRequestStore {
  readonly create: (endpointId: Hex) => PendingRequest | undefined;
  readonly get: (requestId: string) => PendingRequest | undefined;
  readonly setProcessing: (requestId: string) => void;
  readonly setComplete: (requestId: string, result: unknown) => void;
  readonly setFailed: (requestId: string, error: string) => void;
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
    create: (endpointId) => {
      if (store.size() >= MAX_PENDING) return;
      const requestId = keccak256(toHex(`async:${endpointId}:${String(Date.now())}:${String(Math.random())}`));
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
