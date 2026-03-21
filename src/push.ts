import { go } from '@api3/promise-utils';
import type { Hex } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import { callApi } from './api/call';
import { processResponse } from './api/process';
import type { ResolvedEndpoint } from './endpoint';
import { logger } from './logger';
import { deriveBeaconId, signResponse } from './sign';
import type { Push } from './types';

// =============================================================================
// Types
// =============================================================================
interface SignedBeaconData {
  readonly airnode: Hex;
  readonly endpointId: Hex;
  readonly beaconId: Hex;
  readonly timestamp: number;
  readonly data: Hex;
  readonly signature: Hex;
  readonly delayMs: number;
}

interface BeaconStore {
  readonly get: (beaconId: Hex) => SignedBeaconData | undefined;
  readonly list: () => readonly SignedBeaconData[];
}

interface PushDependencies {
  readonly account: PrivateKeyAccount;
  readonly airnode: Hex;
  readonly endpointMap: ReadonlyMap<Hex, ResolvedEndpoint>;
}

interface PushHandle {
  readonly store: BeaconStore;
  readonly stop: () => void;
}

// =============================================================================
// Beacon store (in-memory, latest value per beacon)
// =============================================================================
function createBeaconStore(): BeaconStore & { set: (beaconId: Hex, data: SignedBeaconData) => void } {
  const beacons = new Map<Hex, SignedBeaconData>();

  return {
    get: (beaconId) => beacons.get(beaconId),
    list: () => [...beacons.values()],
    set: (beaconId, data) => {
      beacons.set(beaconId, data); // eslint-disable-line functional/immutable-data
    },
  };
}

// =============================================================================
// Single beacon update
// =============================================================================
async function updateBeacon(
  endpointId: Hex,
  resolved: ResolvedEndpoint,
  deps: PushDependencies
): Promise<SignedBeaconData | undefined> {
  const { api, endpoint } = resolved;

  if (!endpoint.encoding || !endpoint.encoding.type || !endpoint.encoding.path) {
    logger.warn(`Push endpoint ${api.name}/${endpoint.name} has no complete encoding (type+path) — skipping`);
    return undefined;
  }

  const encoding = { type: endpoint.encoding.type, path: endpoint.encoding.path, times: endpoint.encoding.times };

  // Resolve fixed/default parameters (no client parameters for push)
  const parameters: Record<string, string> = {};

  const apiResult = await go(() => callApi(api, endpoint, parameters));
  if (!apiResult.success) {
    logger.error(`Push API call failed for ${api.name}/${endpoint.name}: ${apiResult.error.message}`);
    return undefined;
  }

  const encodedData = processResponse(apiResult.data.data, encoding);
  const timestamp = Math.floor(Date.now() / 1000);
  const signed = await signResponse(deps.account, endpointId, timestamp, encodedData);
  const beaconId = deriveBeaconId(deps.airnode, endpointId);

  const delayMs = resolved.endpoint.cache?.delay ?? resolved.api.cache?.delay ?? 0;

  return {
    airnode: deps.airnode,
    endpointId,
    beaconId,
    timestamp,
    data: encodedData,
    signature: signed.signature,
    delayMs,
  };
}

// =============================================================================
// Push to external cache servers
//
// Retries up to 2 times with 1s static delay. Safe because the cache server's
// setIfNewer is idempotent — re-sending the same signed beacon is a no-op.
// Throws on non-ok HTTP status so go() retries handle both network errors and
// server errors (e.g. 503).
// =============================================================================
const PUSH_RETRY_OPTIONS = { retries: 2, delay: { type: 'static' as const, delayMs: 1000 } };

async function pushToTarget(url: string, authToken: string, body: string): Promise<void> {
  const result = await go(async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body,
    });
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
    return response;
  }, PUSH_RETRY_OPTIONS);

  if (!result.success) {
    logger.warn(`Push to ${url} failed after 3 attempts: ${result.error.message}`);
  }
}

async function pushToTargets(beacon: SignedBeaconData, targets: NonNullable<Push['targets']>): Promise<void> {
  const body = JSON.stringify(beacon);
  await Promise.allSettled(targets.map((target) => pushToTarget(target.url, target.authToken, body)));
}

// =============================================================================
// Push loop
// =============================================================================
function startPushLoop(deps: PushDependencies): PushHandle {
  const store = createBeaconStore();
  const timers: ReturnType<typeof setInterval>[] = [];

  // eslint-disable-next-line functional/no-loop-statements
  for (const [endpointId, resolved] of deps.endpointMap) {
    const pushConfig = resolved.endpoint.push;
    if (!pushConfig) continue;

    const { api, endpoint } = resolved;
    const beaconId = deriveBeaconId(deps.airnode, endpointId);
    const { targets } = pushConfig;

    logger.info(
      `Push loop started: ${api.name}/${endpoint.name} every ${String(pushConfig.interval)}ms (beacon ${beaconId.slice(0, 10)}...)`
    );

    const runUpdate = (): void => {
      void updateBeacon(endpointId, resolved, deps).then((result) => {
        if (!result) return result;
        store.set(beaconId, result);
        if (targets && targets.length > 0) void pushToTargets(result, targets);
        return result;
      });
    };

    runUpdate();
    const timer = setInterval(runUpdate, pushConfig.interval);
    timer.unref();
    timers.push(timer); // eslint-disable-line functional/immutable-data
  }

  return {
    store,
    stop: () => {
      // eslint-disable-next-line functional/no-loop-statements
      for (const timer of timers) {
        clearInterval(timer);
      }
    },
  };
}

export { startPushLoop };
export type { BeaconStore, PushDependencies, PushHandle, SignedBeaconData };
