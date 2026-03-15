import { createHash, timingSafeEqual } from 'node:crypto';
import { go } from '@api3/promise-utils';
import { type Hex, createPublicClient, http, keccak256, toHex } from 'viem';
import { recoverAddress, hashMessage } from 'viem';
import { createBoundedMap } from './bounded-map';
import type { ClientAuth, ClientAuthMethod } from './types';

// =============================================================================
// Types
// =============================================================================
interface AuthSuccess {
  readonly authenticated: true;
}

interface AuthFailure {
  readonly authenticated: false;
  readonly error: string;
}

interface AuthPaymentRequired {
  readonly authenticated: false;
  readonly paymentRequired: true;
  readonly paymentDetails: {
    readonly paymentId: string;
    readonly amount: string;
    readonly token: string;
    readonly network: number;
    readonly recipient: string;
    readonly expiresAt: number;
  };
}

type AuthResult = AuthSuccess | AuthFailure | AuthPaymentRequired;

function isPaymentRequired(result: AuthResult): result is AuthPaymentRequired {
  return !result.authenticated && 'paymentRequired' in result;
}

// =============================================================================
// Shared RPC client pool
// =============================================================================
const rpcClients = new Map<string, ReturnType<typeof createPublicClient>>();

function getPublicClient(rpc: string): ReturnType<typeof createPublicClient> {
  const existing = rpcClients.get(rpc);
  if (existing) return existing;
  const client = createPublicClient({ transport: http(rpc) });
  rpcClients.set(rpc, client); // eslint-disable-line functional/immutable-data
  return client;
}

// =============================================================================
// API key auth
// =============================================================================
function constantTimeEquals(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

function checkApiKey(request: Request, keys: readonly string[]): AuthResult {
  const apiKey = request.headers.get('X-Api-Key');
  if (!apiKey) return { authenticated: false, error: 'Missing X-Api-Key header' };

  const valid = keys.some((key) => constantTimeEquals(apiKey, key));
  if (!valid) return { authenticated: false, error: 'Invalid API key' };

  return { authenticated: true };
}

// =============================================================================
// NFT key auth
// =============================================================================
interface OwnershipEntry {
  readonly owns: boolean;
  readonly checkedAt: number;
}

const ownershipCache = createBoundedMap<string, OwnershipEntry>({
  maxEntries: 10_000,
  sweepIntervalMs: 60_000,
  shouldEvict: (entry) => Date.now() > entry.checkedAt + 5 * 60 * 1000,
});

const AUTH_MESSAGE_PREFIX = 'airnode-auth';
const AUTH_TIMESTAMP_MAX_AGE_MS = 5 * 60 * 1000;

function parseNftKeyHeader(header: string): { address: Hex; timestamp: number; signature: Hex } | undefined {
  const parts = header.split(':');
  if (parts.length !== 3) return undefined;
  const [address, timestampStr, signature] = parts as [string, string, string];
  const timestamp = Number(timestampStr);
  if (Number.isNaN(timestamp)) return undefined;
  if (!address.startsWith('0x') || !signature.startsWith('0x')) return undefined;
  return { address: address as Hex, timestamp, signature: signature as Hex };
}

async function verifyNftKeySignature(request: Request): Promise<{ address: Hex } | AuthFailure> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { authenticated: false, error: 'Missing Authorization: Bearer header' };
  }

  const parsed = parseNftKeyHeader(authHeader.slice(7));
  if (!parsed) {
    return {
      authenticated: false,
      error: 'Invalid NFT key format. Expected: Bearer <address>:<timestamp>:<signature>',
    };
  }

  const age = Date.now() - parsed.timestamp;
  if (age < 0 || age > AUTH_TIMESTAMP_MAX_AGE_MS) {
    return { authenticated: false, error: 'Auth timestamp expired or in the future' };
  }

  const message = `${AUTH_MESSAGE_PREFIX}:${parsed.address}:${String(parsed.timestamp)}`;
  const result = await go(async () => recoverAddress({ hash: hashMessage(message), signature: parsed.signature }));
  if (!result.success) return { authenticated: false, error: 'Invalid signature' };
  if (result.data.toLowerCase() !== parsed.address.toLowerCase()) {
    return { authenticated: false, error: 'Signature does not match address' };
  }

  return { address: parsed.address };
}

async function checkNftKey(
  request: Request,
  config: { readonly rpc: string; readonly contract: string; readonly cacheTtl: number }
): Promise<AuthResult> {
  const sigResult = await verifyNftKeySignature(request);
  if ('authenticated' in sigResult) return sigResult;

  const cacheKey = `${config.contract}:${sigResult.address}`.toLowerCase();
  const cached = ownershipCache.get(cacheKey);
  if (cached && Date.now() <= cached.checkedAt + config.cacheTtl) {
    return cached.owns
      ? { authenticated: true }
      : { authenticated: false, error: 'Address does not hold required NFT' };
  }

  const client = getPublicClient(config.rpc);
  const result = await go(() =>
    client.readContract({
      address: config.contract as Hex,
      abi: [{ type: 'function', name: 'balanceOf', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }],
      functionName: 'balanceOf',
      args: [sigResult.address],
    })
  );
  const owns = result.success && (result.data as bigint) > 0n;

  if (owns) ownershipCache.set(cacheKey, { owns: true, checkedAt: Date.now() });

  if (!owns) return { authenticated: false, error: 'Address does not hold required NFT' };

  return { authenticated: true };
}

// =============================================================================
// x402 payment auth
// =============================================================================
interface PaymentProofEntry {
  readonly usedAt: number;
}

const usedPaymentProofs = createBoundedMap<string, PaymentProofEntry>({
  maxEntries: 50_000,
  sweepIntervalMs: 60_000,
  shouldEvict: (entry) => Date.now() > entry.usedAt + 24 * 60 * 60 * 1000,
});

const ETH_ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const TX_HASH_REGEX = /^0x[\da-fA-F]{64}$/;
const MAX_TX_AGE_SECONDS = 3600;

async function verifyPayment(
  rpc: string,
  txHash: Hex,
  token: string,
  amount: string,
  recipient: string
): Promise<boolean> {
  const client = getPublicClient(rpc);

  const receipt = await go(() => client.getTransactionReceipt({ hash: txHash }));
  if (!receipt.success || receipt.data.status !== 'success') return false;

  // Check transaction recency
  const block = await go(() => client.getBlock({ blockNumber: receipt.data.blockNumber }));
  if (!block.success) return false;
  if (Math.floor(Date.now() / 1000) - Number(block.data.timestamp) > MAX_TX_AGE_SECONDS) return false;

  const requiredAmount = BigInt(amount);

  // ETH transfer
  if (token.toLowerCase() === ETH_ZERO_ADDRESS) {
    const tx = await go(() => client.getTransaction({ hash: txHash }));
    if (!tx.success) return false;
    return tx.data.to?.toLowerCase() === recipient.toLowerCase() && tx.data.value >= requiredAmount;
  }

  // ERC-20 transfer — check Transfer event logs
  const transferTopic = keccak256(toHex('Transfer(address,address,uint256)'));
  return receipt.data.logs.some((log) => {
    if (log.address.toLowerCase() !== token.toLowerCase()) return false;
    if (log.topics[0] !== transferTopic) return false;
    const to = `0x${log.topics[2]?.slice(26) ?? ''}`.toLowerCase();
    if (to !== recipient.toLowerCase()) return false;
    const value = log.data === '0x' ? 0n : BigInt(log.data);
    return value >= requiredAmount;
  });
}

async function checkX402(
  request: Request,
  config: {
    readonly network: number;
    readonly rpc: string;
    readonly token: string;
    readonly amount: string;
    readonly recipient: string;
    readonly expiry: number;
  }
): Promise<AuthResult> {
  const txHash = request.headers.get('X-Payment-Proof');

  if (!txHash) {
    return {
      authenticated: false,
      paymentRequired: true,
      paymentDetails: {
        paymentId: keccak256(toHex(`x402:${String(Date.now())}:${String(Math.random())}`)),
        amount: config.amount,
        token: config.token,
        network: config.network,
        recipient: config.recipient,
        expiresAt: Math.floor(Date.now() / 1000) + Math.floor(config.expiry / 1000),
      },
    };
  }

  if (!TX_HASH_REGEX.test(txHash)) return { authenticated: false, error: 'Invalid transaction hash format' };

  const normalizedHash = txHash.toLowerCase();
  if (usedPaymentProofs.has(normalizedHash)) return { authenticated: false, error: 'Payment proof already used' };

  // Reserve immediately to prevent race conditions
  usedPaymentProofs.set(normalizedHash, { usedAt: Date.now() });

  const valid = await verifyPayment(config.rpc, txHash as Hex, config.token, config.amount, config.recipient);
  if (!valid) {
    usedPaymentProofs.delete(normalizedHash);
    return { authenticated: false, error: 'Payment verification failed' };
  }

  return { authenticated: true };
}

// =============================================================================
// Multi-method dispatch
// =============================================================================
function normalizeAuth(auth: ClientAuth | undefined): readonly ClientAuthMethod[] {
  if (!auth) return [{ type: 'free' }];
  if (Array.isArray(auth)) return auth;
  return [auth];
}

async function checkMethod(request: Request, method: ClientAuthMethod): Promise<AuthResult> {
  if (method.type === 'free') return { authenticated: true };
  if (method.type === 'apiKey') return checkApiKey(request, method.keys);
  if (method.type === 'nftKey') return checkNftKey(request, method);
  return checkX402(request, method);
}

async function authenticateRequest(request: Request, auth?: ClientAuth): Promise<AuthResult> {
  const methods = normalizeAuth(auth);

  // eslint-disable-next-line functional/no-let
  let lastResult: AuthResult = { authenticated: false, error: 'Unauthorized' };

  // eslint-disable-next-line functional/no-loop-statements
  for (const method of methods) {
    const result = await checkMethod(request, method);
    if (result.authenticated) return result;
    lastResult = result;
  }

  return lastResult;
}

export { authenticateRequest, isPaymentRequired };
export type { AuthPaymentRequired, AuthResult };
