import { createHash, timingSafeEqual } from 'node:crypto';
import { go } from '@api3/promise-utils';
import { type Hex, createPublicClient, http, keccak256, toHex } from 'viem';
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
// RPC retry options
//
// Chain RPC nodes frequently return transient errors (502, rate limits, timeouts).
// balanceOf and getTransactionReceipt are pure reads — safe to retry.
// =============================================================================
const RPC_RETRY_OPTIONS = { retries: 2, delay: { type: 'static' as const, delayMs: 500 } };

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

  const receipt = await go(() => client.getTransactionReceipt({ hash: txHash }), RPC_RETRY_OPTIONS);
  if (!receipt.success || receipt.data.status !== 'success') return false;

  // Check transaction recency
  const block = await go(() => client.getBlock({ blockNumber: receipt.data.blockNumber }), RPC_RETRY_OPTIONS);
  if (!block.success) return false;
  if (Math.floor(Date.now() / 1000) - Number(block.data.timestamp) > MAX_TX_AGE_SECONDS) return false;

  const requiredAmount = BigInt(amount);

  // ETH transfer
  if (token.toLowerCase() === ETH_ZERO_ADDRESS) {
    const tx = await go(() => client.getTransaction({ hash: txHash }), RPC_RETRY_OPTIONS);
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
