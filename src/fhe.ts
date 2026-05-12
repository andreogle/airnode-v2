import { go } from '@api3/promise-utils';
import { type Hex, bytesToHex, decodeAbiParameters, encodeAbiParameters } from 'viem';
import { logger } from './logger';
import type { Encrypt } from './types';

// =============================================================================
// FHE encryption
//
// When an endpoint is configured with `encrypt`, the ABI-encoded response value
// is replaced with an FHE ciphertext before signing: the airnode encrypts the
// integer with the target chain's FHE public key, producing an encrypted-input
// handle and a zero-knowledge proof. The signed response then carries
//
//   abi.encode(bytes32 handle, bytes inputProof)
//
// which a callback contract unpacks with `FHE.fromExternal(handle, inputProof)`
// to register the value with the FHE coprocessor. Smart contracts can then
// compute on the ciphertext (compare, add, multiply) but only addresses the
// consuming contract authorizes can ever decrypt it — oracle values stay
// private until the contract explicitly reveals them (no MEV, no free-riding on
// paid data).
//
// An fhEVM encrypted input is bound to two addresses: the contract that ingests
// it (`encrypt.contract` — the callback), and the address that calls that
// contract when it ingests. In the Airnode flow the callback is invoked by
// AirnodeVerifier, so the latter is AirnodeVerifier's address (`verifier`).
// That binding is what stops a signed ciphertext being replayed against a
// different contract.
//
// `@zama-fhe/relayer-sdk` is imported lazily (`import()` inside `getInstance`)
// because it loads multi-megabyte WASM modules (TFHE, KMS) on first use —
// deployments that don't use FHE never pay that cost.
// =============================================================================

// Relayer connection settings — the object form of `settings.fhe`, narrowed
// once FHE is known to be enabled.
interface FheConnection {
  readonly network: 'sepolia' | 'mainnet';
  readonly rpcUrl: string;
  readonly verifier: string;
  readonly apiKey?: string;
}

// Minimal slice of `@zama-fhe/relayer-sdk` we depend on. Declared locally so the
// rest of the module — and its tests — stay decoupled from the SDK surface.
interface EncryptedInputBuilder {
  readonly add8: (value: bigint) => unknown;
  readonly add16: (value: bigint) => unknown;
  readonly add32: (value: bigint) => unknown;
  readonly add64: (value: bigint) => unknown;
  readonly add128: (value: bigint) => unknown;
  readonly add256: (value: bigint) => unknown;
  readonly encrypt: () => Promise<{ readonly handles: readonly Uint8Array[]; readonly inputProof: Uint8Array }>;
}

interface FhevmInstance {
  readonly createEncryptedInput: (contract: string, user: string) => EncryptedInputBuilder;
}

interface RelayerSdkModule {
  readonly createInstance: (config: Record<string, unknown>) => Promise<FhevmInstance>;
  readonly SepoliaConfig: Record<string, unknown>;
  readonly MainnetConfig: Record<string, unknown>;
}

// =============================================================================
// Value extraction
// =============================================================================

// FHE integers are unsigned and width-limited. The response is ABI-encoded as a
// single `int256`/`uint256` word (enforced by the config schema); decode it,
// reject negatives, and reject values that overflow the configured type.
function bitWidth(type: Encrypt['type']): number {
  return Number(type.slice('euint'.length));
}

function decodeInteger(encodedData: Hex, solidityType: string): bigint {
  const [value] = decodeAbiParameters([{ type: solidityType }], encodedData);
  if (typeof value !== 'bigint') {
    throw new TypeError(`Expected ${solidityType} value to decode to a bigint`);
  }
  return value;
}

function toEncryptableValue(encodedData: Hex, solidityType: string, type: Encrypt['type']): bigint {
  const value = decodeInteger(encodedData, solidityType);
  if (value < 0n) {
    throw new RangeError(`Cannot FHE-encrypt negative value ${value.toString()} — FHE integers are unsigned`);
  }
  if (value >= 2n ** BigInt(bitWidth(type))) {
    throw new RangeError(`Value ${value.toString()} does not fit in ${type}`);
  }
  return value;
}

function addValue(builder: EncryptedInputBuilder, type: Encrypt['type'], value: bigint): void {
  switch (type) {
    case 'euint8': {
      builder.add8(value);
      return;
    }
    case 'euint16': {
      builder.add16(value);
      return;
    }
    case 'euint32': {
      builder.add32(value);
      return;
    }
    case 'euint64': {
      builder.add64(value);
      return;
    }
    case 'euint128': {
      builder.add128(value);
      return;
    }
    case 'euint256': {
      builder.add256(value);
      return;
    }
  }
}

// =============================================================================
// Relayer instance (lazy, shared for the process lifetime)
//
// The SDK fetches the chain's FHE public key from the relayer on first use and
// caches it internally — re-creating it per request would re-fetch keys and
// re-init WASM every time. We cache the *promise*, so concurrent first requests
// share one `createInstance` call; a rejected promise is dropped so the next
// request retries (which also picks up a rotated chain key after a clear).
// =============================================================================
// eslint-disable-next-line functional/no-let
let cachedInstance: Promise<FhevmInstance> | undefined;
// eslint-disable-next-line functional/no-let
let cachedConnectionKey: string | undefined;

function buildInstanceConfig(preset: Record<string, unknown>, connection: FheConnection): Record<string, unknown> {
  // `network` is the Ethereum RPC endpoint the SDK uses to read on-chain FHE
  // contracts (ACL, KMS verifier) for the target chain.
  const base: Record<string, unknown> = { ...preset, network: connection.rpcUrl };
  if (!connection.apiKey) return base;
  return { ...base, auth: { __type: 'ApiKeyHeader', value: connection.apiKey } };
}

async function loadInstance(connection: FheConnection): Promise<FhevmInstance> {
  const sdk = (await import('@zama-fhe/relayer-sdk/node')) as unknown as RelayerSdkModule;
  const preset = connection.network === 'mainnet' ? sdk.MainnetConfig : sdk.SepoliaConfig;
  const instance = await sdk.createInstance(buildInstanceConfig(preset, connection));
  logger.info(`FHE relayer instance initialized (network: ${connection.network})`);
  return instance;
}

function getInstance(connection: FheConnection): Promise<FhevmInstance> {
  const key = `${connection.network}|${connection.rpcUrl}`;
  if (!cachedInstance || cachedConnectionKey !== key) {
    cachedConnectionKey = key;
    cachedInstance = loadInstance(connection).catch((error: unknown) => {
      if (cachedConnectionKey === key) resetFheInstance();
      throw error;
    });
  }
  return cachedInstance;
}

// Drop the cached instance. Called on a relayer error (rebuild on the next
// request, also picking up a rotated chain key) and by tests that swap the
// mocked SDK between cases.
function resetFheInstance(): void {
  cachedInstance = undefined;
  cachedConnectionKey = undefined;
}

// =============================================================================
// Encryption
// =============================================================================
const HANDLE_AND_PROOF_ABI = [{ type: 'bytes32' }, { type: 'bytes' }] as const;

async function encryptResponse(
  connection: FheConnection,
  encrypt: Encrypt,
  encodedData: Hex,
  solidityType: string
): Promise<Hex> {
  // Value validation first: a bad request value is not a relayer problem, so it
  // must not invalidate the cached instance.
  const value = toEncryptableValue(encodedData, solidityType, encrypt.type);

  const instance = await getInstance(connection);

  // Bind the encrypted input to the consumer contract and to AirnodeVerifier —
  // the address that will call the consumer's callback when it ingests this.
  const encrypted = await go(async () => {
    const input = instance.createEncryptedInput(encrypt.contract, connection.verifier);
    addValue(input, encrypt.type, value);
    return input.encrypt();
  });
  if (!encrypted.success) {
    // The relayer's state may have moved on under us — drop the cached instance
    // so the next request rebuilds it.
    resetFheInstance();
    throw encrypted.error;
  }

  const { handles, inputProof } = encrypted.data;
  const handle = handles[0];
  if (!handle) {
    throw new Error('FHE encryption produced no handles');
  }
  if (handle.length !== 32) {
    throw new Error(`FHE handle has ${String(handle.length)} bytes, expected 32`);
  }

  const packed = encodeAbiParameters(HANDLE_AND_PROOF_ABI, [bytesToHex(handle), bytesToHex(inputProof)]);
  logger.debug(
    `FHE-encrypted ${encrypt.type} value for contract ${encrypt.contract} (proof ${String(inputProof.length)} bytes)`
  );
  return packed;
}

export { encryptResponse, resetFheInstance };
export type { FheConnection };
