// =============================================================================
// FHE encryption plugin — Encrypts responses for on-chain confidentiality
//
// Encrypts ABI-encoded response data with the chain's FHE public key before
// signing. The signed response contains ciphertext instead of plaintext — smart
// contracts can compute on the encrypted data (compare, add, multiply) but only
// addresses explicitly authorized by the consuming contract can decrypt.
//
// How it works:
//   1. Airnode fetches API data and ABI-encodes the response as usual.
//   2. This plugin intercepts the encoded data in onBeforeSign.
//   3. The plugin encrypts the value using @zama-fhe/relayer-sdk, producing an encrypted
//      input reference (einput) and a zero-knowledge proof (inputProof).
//   4. The plugin packs abi.encode(einput, inputProof) as the new data field.
//   5. Airnode signs the ciphertext — the signature proves the encrypted data
//      is authentically from the API provider.
//   6. The client submits the signed ciphertext to AirnodeVerifier on-chain.
//   7. The callback contract registers the FHE handle and manages decryption
//      access (see contracts/src/examples/ConfidentialPriceFeed.sol).
//
// Why FHE instead of regular encryption:
//   Regular encryption requires decrypting before computation. FHE lets smart
//   contracts operate on encrypted values directly — a lending protocol can
//   check "is price < liquidation threshold" without ever seeing the price.
//   This prevents MEV, protects paid data from free-riders, and keeps oracle
//   values private until the consuming contract explicitly reveals them.
//
// Config:
//   settings:
//     plugins:
//       - source: ./examples/plugins/fhe-encrypt/dist/index.js
//         timeout: 30000
//
// Environment:
//   FHE_NETWORK           — 'sepolia' or 'mainnet' (selects the preset config)
//   FHE_NETWORK_URL       — Ethereum JSON-RPC URL for the target chain
//   FHE_API_KEY           — (optional) API key for Zama's hosted relayer
//   FHE_CONTRACT_ADDRESS  — Contract that will receive the encrypted data
//   AIRNODE_ADDRESS        — The airnode's address (binds encrypted input)
//
// Build:
//   cd examples/plugins/fhe-encrypt && bun install && bun run build
// =============================================================================

import { createInstance, SepoliaConfig, MainnetConfig } from '@zama-fhe/relayer-sdk/node';

// =============================================================================
// Plugin types (inlined — the package does not export them yet)
// =============================================================================
type Hex = `0x${string}`;

interface BeforeSignContext {
  readonly endpointId: Hex;
  readonly api: string;
  readonly endpoint: string;
  readonly data: Hex;
  readonly signal: AbortSignal;
}

type BeforeSignResult = { readonly data: Hex } | undefined;

interface ErrorContext {
  readonly error: Error;
  readonly stage: string;
  readonly endpointId?: Hex;
}

interface AirnodePlugin {
  readonly name: string;
  readonly hooks: {
    readonly onBeforeSign?: (context: BeforeSignContext) => BeforeSignResult | Promise<BeforeSignResult>;
    readonly onError?: (context: ErrorContext) => void;
  };
}

// =============================================================================
// Environment
// =============================================================================
const PREFIX = '[fhe-encrypt]';

const FHE_NETWORK = process.env['FHE_NETWORK'] ?? 'sepolia';
const FHE_NETWORK_URL = process.env['FHE_NETWORK_URL'];
const FHE_API_KEY = process.env['FHE_API_KEY'];
const FHE_CONTRACT_ADDRESS = process.env['FHE_CONTRACT_ADDRESS'];
const AIRNODE_ADDRESS = process.env['AIRNODE_ADDRESS'];

// =============================================================================
// fhEVM instance (lazy-loaded, cached after first call)
//
// The @zama-fhe/relayer-sdk fetches the chain's FHE public key from the network
// and provides methods to encrypt values. The instance is created once and
// reused for all requests.
// =============================================================================
interface EncryptResult {
  readonly handles: readonly Uint8Array[];
  readonly inputProof: Uint8Array;
}

interface EncryptedInput {
  readonly add256: (value: bigint) => void;
  readonly encrypt: () => Promise<EncryptResult>;
}

interface FhevmInstance {
  readonly createEncryptedInput: (contractAddress: string, userAddress: string) => EncryptedInput;
}

// eslint-disable-next-line functional/no-let
let cachedInstance: FhevmInstance | undefined;

function resolveConfig(): Record<string, unknown> {
  if (!FHE_NETWORK_URL) {
    throw new Error('FHE_NETWORK_URL is required — set it to an Ethereum RPC endpoint for the target chain');
  }

  const presets: Record<string, Record<string, unknown>> = {
    sepolia: SepoliaConfig as unknown as Record<string, unknown>,
    mainnet: MainnetConfig as unknown as Record<string, unknown>,
  };

  const preset = presets[FHE_NETWORK];
  if (!preset) {
    throw new Error(`Unknown FHE_NETWORK "${FHE_NETWORK}" — expected "sepolia" or "mainnet"`);
  }

  // The preset provides contract addresses, chain IDs, and relayer URL.
  // The network field is the RPC endpoint the SDK uses to talk to on-chain
  // contracts (e.g. ACL, KMS verifier). It must be a standard Ethereum RPC URL.
  const config: Record<string, unknown> = { ...preset, network: FHE_NETWORK_URL };

  // Attach API key auth if provided (may be required by Zama's hosted relayer)
  if (FHE_API_KEY) {
    config['auth'] = { __type: 'ApiKeyHeader', value: FHE_API_KEY }; // eslint-disable-line functional/immutable-data
  }

  return config;
}

async function getInstance(): Promise<FhevmInstance> {
  if (cachedInstance) return cachedInstance;

  const config = resolveConfig();

  cachedInstance = (await createInstance(config)) as unknown as FhevmInstance;
  console.info(`${PREFIX} FHE instance initialized (network: ${FHE_NETWORK})`);
  return cachedInstance;
}

// =============================================================================
// Hex helpers
// =============================================================================
function bytesToHex(bytes: Uint8Array): Hex {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

// =============================================================================
// ABI encoding
//
// Pack (bytes32 handle, bytes inputProof) into ABI-encoded bytes so the
// callback contract can decode with:
//   (bytes32 handleRef, bytes memory inputProof) = abi.decode(data, (bytes32, bytes));
// =============================================================================
function abiEncodeHandleAndProof(handleHex: string, inputProof: Uint8Array): Hex {
  // handle is already a bytes32 hex string from the SDK
  const cleanHandle = handleHex.replace(/^0x/, '').padStart(64, '0');

  // ABI layout for (bytes32, bytes):
  //   0x00: bytes32 value
  //   0x20: offset to dynamic bytes (always 0x40 for this layout)
  //   0x40: length of bytes
  //   0x60: bytes data (right-padded to 32-byte boundary)
  const offset = '0000000000000000000000000000000000000000000000000000000000000040';
  const proofHex = bytesToHex(inputProof).slice(2);
  const proofLength = inputProof.length.toString(16).padStart(64, '0');
  const proofPadded = proofHex.padEnd(Math.ceil(proofHex.length / 64) * 64, '0');

  return `0x${cleanHandle}${offset}${proofLength}${proofPadded}`;
}

// =============================================================================
// Plugin
// =============================================================================
const plugin: AirnodePlugin = {
  name: 'fhe-encrypt',
  hooks: {
    // =========================================================================
    // onBeforeSign — encrypt ABI-encoded data with the chain's FHE public key
    //
    // Input:  ctx.data is the plaintext ABI-encoded value (e.g. uint256 price)
    // Output: abi.encode(bytes32 handle, bytes inputProof)
    //
    // The callback contract unpacks this and calls TFHE.asEuint256(handle, inputProof)
    // to register the handle with the FHE coprocessor.
    // =========================================================================
    onBeforeSign: async (ctx: BeforeSignContext): Promise<BeforeSignResult> => {
      if (!FHE_CONTRACT_ADDRESS || !AIRNODE_ADDRESS) {
        console.error(`${PREFIX} FHE_CONTRACT_ADDRESS and AIRNODE_ADDRESS must be set`);
        return;
      }

      console.info(
        `${PREFIX} ${ctx.api}/${ctx.endpoint}: encrypting ${String(ctx.data.length / 2 - 1)} bytes of ABI data`
      );
      const start = Date.now();

      const instance = await getInstance();

      // Interpret the ABI-encoded data as a uint256 value
      const value = BigInt(ctx.data.length > 2 ? ctx.data : '0x0');

      console.info(
        `${PREFIX} ${ctx.api}/${ctx.endpoint}: plaintext value ${value.toString()} → encrypting for contract ${FHE_CONTRACT_ADDRESS}`
      );

      // Encrypt with the chain's FHE public key. The encrypted input is bound
      // to the target contract and the airnode's address, preventing replay of
      // encrypted values across different contexts.
      const input = instance.createEncryptedInput(FHE_CONTRACT_ADDRESS, AIRNODE_ADDRESS);
      input.add256(value);

      const encryptStart = Date.now();
      const { handles, inputProof } = await input.encrypt();
      const encryptMs = Date.now() - encryptStart;

      const handle = handles[0];
      if (!handle) {
        console.error(`${PREFIX} ${ctx.api}/${ctx.endpoint}: FHE encryption produced no handles`);
        return;
      }

      const handleHex = bytesToHex(handle);
      const packed = abiEncodeHandleAndProof(handleHex, inputProof);
      const totalMs = Date.now() - start;

      console.info(
        `${PREFIX} ${ctx.api}/${ctx.endpoint}: encrypted → handle ${handleHex.slice(0, 18)}... proof ${String(inputProof.length)} bytes (encrypt: ${String(encryptMs)}ms, total: ${String(totalMs)}ms)`
      );

      return { data: packed };
    },

    onError: (ctx: ErrorContext) => {
      console.error(
        `${PREFIX} Error in ${ctx.stage}${ctx.endpointId ? ` (endpoint ${ctx.endpointId.slice(0, 18)}...)` : ''}: ${ctx.error.message}`
      );
    },
  },
};

export default plugin;
