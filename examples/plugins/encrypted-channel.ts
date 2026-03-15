// =============================================================================
// Encrypted channel plugin — ECIES-encrypted request-response
//
// Creates an encrypted channel between the requester and the airnode so that
// observers see opaque blobs in both directions:
//
//   1. Client encrypts request parameters with the airnode's public key
//   2. This plugin decrypts the parameters before the API call
//   3. The decrypted parameters must include a `_responsePublicKey` field —
//      the requester's ephemeral public key for encrypting the response
//   4. After the API call, the plugin encrypts the signed data with the
//      requester's public key
//   5. Observers see opaque blobs in both directions
//
// Encryption scheme: ECIES with secp256k1 ECDH + AES-256-GCM
//
//   encrypt(plaintext, recipientPubKey):
//     1. Generate ephemeral secp256k1 keypair
//     2. ECDH shared secret = ephemeralPrivKey * recipientPubKey
//     3. Derive AES key via HKDF-SHA256(sharedSecret)
//     4. AES-256-GCM encrypt plaintext
//     5. Output: ephemeralPubKey || nonce || ciphertext || tag
//
//   decrypt(payload, recipientPrivKey):
//     1. Parse ephemeralPubKey, nonce, ciphertext, tag from payload
//     2. ECDH shared secret = recipientPrivKey * ephemeralPubKey
//     3. Derive AES key via HKDF-SHA256(sharedSecret)
//     4. AES-256-GCM decrypt
//
// Usage:
//   settings:
//     plugins:
//       - source: ./examples/plugins/encrypted-channel.ts
//         timeout: 5000
//
// Environment:
//   AIRNODE_PRIVATE_KEY must be set (the airnode's secp256k1 private key)
//
// Client-side encryption (TypeScript):
//   import { encrypt } from './examples/plugins/encrypted-channel';
//   const ciphertext = encrypt(JSON.stringify(params), airnodePublicKey);
//   // Pass ciphertext as the parameters field in the HTTP request
// =============================================================================

import { gcm } from '@noble/ciphers/aes';
import { secp256k1 } from '@noble/curves/secp256k1';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';
import { randomBytes } from '@noble/hashes/utils';

// =============================================================================
// Plugin types (inlined — the package does not export them yet)
// =============================================================================
type Hex = `0x${string}`;

interface BeforeApiCallContext {
  readonly endpointId: Hex;
  readonly api: string;
  readonly endpoint: string;
  readonly parameters: Record<string, string>;
}

interface BeforeSignContext {
  readonly endpointId: Hex;
  readonly api: string;
  readonly endpoint: string;
  readonly data: Hex;
}

interface ErrorContext {
  readonly error: Error;
  readonly stage: string;
  readonly endpointId?: Hex;
}

type BeforeApiCallResult = { readonly parameters: Record<string, string> } | undefined;
type BeforeSignResult = { readonly data: Hex } | undefined;

interface AirnodePlugin {
  readonly name: string;
  readonly hooks: {
    readonly onBeforeApiCall?: (context: BeforeApiCallContext) => BeforeApiCallResult;
    readonly onBeforeSign?: (context: BeforeSignContext) => BeforeSignResult;
    readonly onError?: (context: ErrorContext) => void;
  };
}

// =============================================================================
// Constants
// =============================================================================
const HKDF_INFO = new TextEncoder().encode('airnode-ecies-v1');
const AES_KEY_LENGTH = 32; // 256-bit
const NONCE_LENGTH = 12; // 96-bit for AES-GCM
const PUBKEY_LENGTH = 33; // compressed secp256k1 public key
const TAG_LENGTH = 16; // AES-GCM authentication tag

// =============================================================================
// ECIES encryption/decryption
// =============================================================================

/**
 * Encrypt plaintext for a recipient identified by their secp256k1 public key.
 *
 * Output format: ephemeralPubKey (33 bytes) || nonce (12 bytes) || ciphertext || tag (16 bytes)
 *
 * This function is exported for use by sponsors/requesters who need to encrypt
 * request parameters before submitting them on-chain.
 */
function encrypt(plaintext: Uint8Array, recipientPubKey: Uint8Array): Uint8Array {
  const ephemeralPrivKey = secp256k1.utils.randomPrivateKey();
  const ephemeralPubKey = secp256k1.getPublicKey(ephemeralPrivKey, true);

  const sharedPoint = secp256k1.getSharedSecret(ephemeralPrivKey, recipientPubKey);
  const aesKey = hkdf(sha256, sharedPoint.slice(1), undefined, HKDF_INFO, AES_KEY_LENGTH);

  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = gcm(aesKey, nonce);
  const ciphertext = cipher.encrypt(plaintext);

  // Concatenate: ephemeralPubKey || nonce || ciphertext (includes GCM tag)
  const output = new Uint8Array(PUBKEY_LENGTH + NONCE_LENGTH + ciphertext.length);
  output.set(ephemeralPubKey, 0);
  output.set(nonce, PUBKEY_LENGTH);
  output.set(ciphertext, PUBKEY_LENGTH + NONCE_LENGTH);
  return output;
}

/**
 * Decrypt ciphertext using the recipient's secp256k1 private key.
 *
 * Input format: ephemeralPubKey (33 bytes) || nonce (12 bytes) || ciphertext || tag (16 bytes)
 */
function decrypt(payload: Uint8Array, recipientPrivKey: Uint8Array): Uint8Array {
  const ephemeralPubKey = payload.slice(0, PUBKEY_LENGTH);
  const nonce = payload.slice(PUBKEY_LENGTH, PUBKEY_LENGTH + NONCE_LENGTH);
  const ciphertext = payload.slice(PUBKEY_LENGTH + NONCE_LENGTH);

  const sharedPoint = secp256k1.getSharedSecret(recipientPrivKey, ephemeralPubKey);
  const aesKey = hkdf(sha256, sharedPoint.slice(1), undefined, HKDF_INFO, AES_KEY_LENGTH);

  const cipher = gcm(aesKey, nonce);
  return cipher.decrypt(ciphertext);
}

// =============================================================================
// Hex conversion helpers
// =============================================================================
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  return Uint8Array.from(clean.match(/.{1,2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? []);
}

function bytesToHex(bytes: Uint8Array): Hex {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

// =============================================================================
// State — the requester's response public key, set during decryption
// =============================================================================
const responseKeys = new Map<string, Uint8Array>();

// =============================================================================
// Plugin implementation
// =============================================================================
const PREFIX = '[encrypted-channel]';

const PRIVATE_KEY_HEX = process.env['AIRNODE_PRIVATE_KEY'];

const plugin: AirnodePlugin = {
  name: 'encrypted-channel',
  hooks: {
    // =========================================================================
    // onBeforeApiCall — decrypt request parameters
    //
    // The `parameters` object is expected to have a single key `_encrypted`
    // whose value is the hex-encoded ECIES ciphertext. After decryption, the
    // plaintext is parsed as JSON to produce the real parameter map.
    //
    // The decrypted parameters may include a `_responsePublicKey` field — a
    // hex-encoded compressed secp256k1 public key. If present, it is stored
    // and used to encrypt the signed data in onBeforeSign.
    // =========================================================================
    onBeforeApiCall: (ctx: BeforeApiCallContext): BeforeApiCallResult => {
      const encrypted = ctx.parameters['_encrypted'];
      if (!encrypted) return;
      if (!PRIVATE_KEY_HEX) {
        console.error(`${PREFIX} AIRNODE_PRIVATE_KEY not set — cannot decrypt request parameters`);
        return;
      }

      const privKey = hexToBytes(PRIVATE_KEY_HEX);
      const ciphertext = hexToBytes(encrypted);

      if (ciphertext.length < PUBKEY_LENGTH + NONCE_LENGTH + TAG_LENGTH) {
        console.error(`${PREFIX} Encrypted payload too short (${String(ciphertext.length)} bytes)`);
        return;
      }

      const plaintext = decrypt(ciphertext, privKey);
      const decoded = JSON.parse(new TextDecoder().decode(plaintext)) as Record<string, string>;

      // Extract and store the response public key if provided
      const responsePublicKey = decoded['_responsePublicKey'];
      if (responsePublicKey) {
        responseKeys.set(ctx.endpointId, hexToBytes(responsePublicKey)); // eslint-disable-line functional/immutable-data
        console.info(
          `${PREFIX} Endpoint ${ctx.endpointId.slice(0, 10)}...: decrypted parameters for ${ctx.api}/${ctx.endpoint}, response encryption enabled`
        );
      } else {
        console.info(
          `${PREFIX} Endpoint ${ctx.endpointId.slice(0, 10)}...: decrypted parameters for ${ctx.api}/${ctx.endpoint}, response will be plaintext (no _responsePublicKey)`
        );
      }

      // Remove the meta-key and return real parameters
      const { _responsePublicKey: _, ...realParameters } = decoded;
      return { parameters: realParameters };
    },

    // =========================================================================
    // onBeforeSign — encrypt data with requester's public key
    //
    // If a _responsePublicKey was provided during parameter decryption, the
    // data to be signed is encrypted with that key. The HTTP response contains
    // the ECIES ciphertext instead of plaintext ABI data.
    //
    // The requester must decrypt client-side to access the actual data.
    // =========================================================================
    onBeforeSign: (ctx: BeforeSignContext): BeforeSignResult => {
      const responsePubKey = responseKeys.get(ctx.endpointId);
      if (!responsePubKey) return;

      // Clean up stored key
      responseKeys.delete(ctx.endpointId); // eslint-disable-line functional/immutable-data

      const plainData = hexToBytes(ctx.data);
      const encryptedData = encrypt(plainData, responsePubKey);
      const encryptedHex = bytesToHex(encryptedData);

      console.info(
        `${PREFIX} Endpoint ${ctx.endpointId.slice(0, 10)}...: encrypted data for ${ctx.api}/${ctx.endpoint} (${String(plainData.length)} → ${String(encryptedData.length)} bytes)`
      );

      return { data: encryptedHex };
    },

    onError: (ctx: ErrorContext) => {
      // Clean up any stored keys on error to prevent memory leaks
      if (ctx.endpointId) {
        responseKeys.delete(ctx.endpointId); // eslint-disable-line functional/immutable-data
      }
    },
  },
};

export default plugin;
export { decrypt, encrypt };
