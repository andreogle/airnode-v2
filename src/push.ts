import { go } from '@api3/promise-utils';
import type { Hex } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import { callApi } from './api/call';
import { processResponse } from './api/process';
import type { ResolvedEndpoint } from './endpoint';
import { logger } from './logger';
import { deriveBeaconId, signResponse } from './sign';

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

  if (!endpoint.encoding) {
    logger.warn(`Push endpoint ${api.name}/${endpoint.name} has no encoding — skipping`);
    return undefined;
  }

  // Resolve fixed/default parameters (no client parameters for push)
  const parameters: Record<string, string> = {};

  const apiResult = await go(() => callApi(api, endpoint, parameters));
  if (!apiResult.success) {
    logger.error(`Push API call failed for ${api.name}/${endpoint.name}: ${apiResult.error.message}`);
    return undefined;
  }

  const encodedData = processResponse(apiResult.data.data, endpoint.encoding);
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

    logger.info(
      `Push loop started: ${api.name}/${endpoint.name} every ${String(pushConfig.interval)}ms (beacon ${beaconId.slice(0, 10)}...)`
    );

    const runUpdate = (): void => {
      void updateBeacon(endpointId, resolved, deps).then((result) => {
        if (result) store.set(beaconId, result);
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
