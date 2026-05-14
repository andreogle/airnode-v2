import { createHash, timingSafeEqual } from 'node:crypto';
import { go, goSync } from '@api3/promise-utils';
import { type Hex, createPublicClient, encodePacked, http, keccak256, recoverMessageAddress, toHex } from 'viem';
import { createBoundedMap } from './bounded-map';
import { checkRateLimit } from './rate-limit';
import type { TokenBucket } from './rate-limit';
import type { ClientAuth, ClientAuthMethod } from './types';

// =============================================================================
// Types
// =============================================================================
interface AuthContext {
  readonly endpointId: Hex;
  readonly airnode: Hex;
  // Client IP for the dedicated x402-verification rate-limit. Optional so
  // programmatic test callers can omit it; production always passes it from
  // the server's `resolveClientIp(...)`. Missing IPs share one ('unknown') bucket.
  readonly clientIp?: string;
}

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
    readonly airnode: Hex;
    readonly endpointId: Hex;
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
//
// `verifyPayment` only needs three read methods. We model that narrow surface
// explicitly (a) so it's clear what an RPC outage / mismatch can affect and
// (b) so tests can inject a fake client via `setRpcClientFactory`.
// =============================================================================
interface RpcLog {
  readonly address: string;
  readonly topics: readonly string[];
  readonly data: string;
}
interface RpcClient {
  readonly getTransactionReceipt: (args: { readonly hash: Hex }) => Promise<{
    readonly status: 'success' | 'reverted';
    readonly blockNumber: bigint;
    readonly logs: readonly RpcLog[];
  }>;
  readonly getBlock: (args: { readonly blockNumber: bigint }) => Promise<{ readonly timestamp: bigint }>;
  readonly getTransaction: (args: {
    readonly hash: Hex;
  }) => Promise<{ readonly from: string; readonly to: string | null; readonly value: bigint }>;
}

const defaultRpcClientFactory = (rpc: string): RpcClient => createPublicClient({ transport: http(rpc) });

const rpcClients = new Map<string, RpcClient>();
// eslint-disable-next-line functional/no-let
let rpcClientFactory: (rpc: string) => RpcClient = defaultRpcClientFactory;

function getPublicClient(rpc: string): RpcClient {
  const existing = rpcClients.get(rpc);
  if (existing) return existing;
  const client = rpcClientFactory(rpc);
  rpcClients.set(rpc, client); // eslint-disable-line functional/immutable-data
  return client;
}

// Swap the RPC client factory and clear the pool. Pass nothing to restore the
// real (viem http) factory. Intended for tests — production never calls this.
function setRpcClientFactory(factory?: (rpc: string) => RpcClient): void {
  rpcClientFactory = factory ?? defaultRpcClientFactory;
  rpcClients.clear(); // eslint-disable-line functional/immutable-data
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
//
// Note: this is an x402-*flavoured* scheme (HTTP 402 pay-per-request), not the
// x402 wire protocol — clients pay on-chain first and then prove the confirmed
// transaction, rather than handing over a signed EIP-3009 authorization.
//
// A client authorises a specific request by signing
//   keccak256(encodePacked(airnode, endpointId, uint64(expiresAt)))
// with the EOA that sent the payment transaction. Airnode recovers the signer,
// checks tx.from matches, and enforces a tight expiresAt window. This prevents:
//   - Mempool observers from stealing a victim's payment (they can't produce
//     a signature from the payer's key).
//   - Cross-endpoint upgrade attacks (signature binds to endpointId).
//   - Cross-airnode reuse (signature binds to airnode address).
//   - Long-lived replay (expiresAt <= MAX_PROOF_LIFETIME_MS).
// Per-payment uniqueness is the on-chain tx hash, deduplicated in
// `usedPaymentProofs` — each confirmed transaction is redeemable exactly once.
// =============================================================================
interface PaymentProofEntry {
  readonly usedAt: number;
}

interface PaymentProofHeader {
  readonly txHash: Hex;
  readonly expiresAt: number;
  readonly signature: Hex;
}

const MAX_TX_AGE_SECONDS = 600;
const PROOF_RETENTION_MS = (MAX_TX_AGE_SECONDS + 60) * 1000;
const MAX_PROOF_LIFETIME_MS = 10 * 60 * 1000;

// Replay protection. FIFO eviction is refused for entries that are still
// within the recency window enforced by verifyPayment — otherwise a flooder
// could push legitimate entries out and replay them.
const usedPaymentProofs = createBoundedMap<string, PaymentProofEntry>({
  maxEntries: 500_000,
  sweepIntervalMs: 60_000,
  shouldEvict: (entry) => Date.now() > entry.usedAt + PROOF_RETENTION_MS,
  refuseEvictionIf: (entry) => Date.now() - entry.usedAt < PROOF_RETENTION_MS,
});

// =============================================================================
// x402 DoS guard — verification rate limit
//
// `verifyPayment` hits the chain RPC (3 reads × up to 3 retries) per attempt,
// so unauthenticated callers spamming bogus `X-Payment-Proof` headers would
// otherwise drain the operator's RPC quota. A separate, much stricter per-IP
// token bucket on x402 verification attempts (the global `server.rateLimit`
// counts every route equally — `/health` probes shouldn't shrink the budget
// available to fight off an x402 flood).
// =============================================================================
const X402_RATE_LIMIT_WINDOW_MS = 60_000;
const X402_RATE_LIMIT_MAX = 30;
const x402AttemptBuckets = new Map<string, TokenBucket>();

const ETH_ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const TX_HASH_REGEX = /^0x[\da-fA-F]{64}$/;
const ADDRESS_REGEX = /^0x[\da-fA-F]{40}$/;
const HEX_SIGNATURE_REGEX = /^0x[\da-fA-F]+$/;

function buildPaymentAuthHash(airnode: Hex, endpointId: Hex, expiresAt: number): Hex {
  return keccak256(encodePacked(['address', 'bytes32', 'uint64'], [airnode, endpointId, BigInt(expiresAt)]));
}

function parsePaymentProof(raw: string): PaymentProofHeader | string {
  const parsed = goSync(() => JSON.parse(raw) as unknown);
  if (!parsed.success) return 'X-Payment-Proof must be a JSON object';

  const p = parsed.data as Partial<PaymentProofHeader> | null;
  if (!p || typeof p !== 'object') return 'X-Payment-Proof must be a JSON object';

  if (typeof p.txHash !== 'string' || !TX_HASH_REGEX.test(p.txHash)) return 'Invalid txHash in payment proof';
  if (typeof p.expiresAt !== 'number' || !Number.isFinite(p.expiresAt)) return 'Invalid expiresAt in payment proof';
  if (typeof p.signature !== 'string' || !HEX_SIGNATURE_REGEX.test(p.signature)) {
    return 'Invalid signature in payment proof';
  }

  return {
    txHash: p.txHash,
    expiresAt: p.expiresAt,
    signature: p.signature,
  };
}

async function verifyPayment(
  rpc: string,
  txHash: Hex,
  token: string,
  amount: string,
  recipient: string,
  expectedPayer: Hex
): Promise<boolean> {
  const client = getPublicClient(rpc);

  const receipt = await go(() => client.getTransactionReceipt({ hash: txHash }), RPC_RETRY_OPTIONS);
  if (!receipt.success || receipt.data.status !== 'success') return false;

  // Check transaction recency
  const block = await go(() => client.getBlock({ blockNumber: receipt.data.blockNumber }), RPC_RETRY_OPTIONS);
  if (!block.success) return false;
  if (Math.floor(Date.now() / 1000) - Number(block.data.timestamp) > MAX_TX_AGE_SECONDS) return false;

  // The transaction sender must match the signer of the payment-auth message —
  // this binds the on-chain payment to the off-chain request authorisation.
  const tx = await go(() => client.getTransaction({ hash: txHash }), RPC_RETRY_OPTIONS);
  if (!tx.success) return false;
  if (tx.data.from.toLowerCase() !== expectedPayer.toLowerCase()) return false;

  const requiredAmount = BigInt(amount);

  // ETH transfer
  if (token.toLowerCase() === ETH_ZERO_ADDRESS) {
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
  context: AuthContext,
  config: {
    readonly network: number;
    readonly rpc: string;
    readonly token: string;
    readonly amount: string;
    readonly recipient: string;
    readonly expiry: number;
  }
): Promise<AuthResult> {
  const proofHeader = request.headers.get('X-Payment-Proof');

  if (!proofHeader) {
    return {
      authenticated: false,
      paymentRequired: true,
      paymentDetails: {
        airnode: context.airnode,
        endpointId: context.endpointId,
        amount: config.amount,
        token: config.token,
        network: config.network,
        recipient: config.recipient,
        expiresAt: Math.floor(Date.now() / 1000) + Math.floor(config.expiry / 1000),
      },
    };
  }

  // A submitted proof — whether bogus or not — will hit the chain RPC in
  // verifyPayment. Apply a stricter per-IP bucket here so an attacker can't use
  // a single permissive `server.rateLimit` to flood the verification path and
  // drain the operator's RPC quota. The bucket is independent of the global
  // limit; missing client IPs (programmatic callers) share an 'unknown' bucket.
  const verifierIp = context.clientIp ?? 'unknown';
  if (!checkRateLimit(verifierIp, x402AttemptBuckets, X402_RATE_LIMIT_WINDOW_MS, X402_RATE_LIMIT_MAX)) {
    return { authenticated: false, error: 'Too many x402 verification attempts — slow down' };
  }

  const parsed = parsePaymentProof(proofHeader);
  if (typeof parsed === 'string') return { authenticated: false, error: parsed };

  // expiresAt is a unix-seconds timestamp from the client. Reject proofs that
  // have already expired or are valid for longer than MAX_PROOF_LIFETIME_MS —
  // the latter keeps the signing authorisation tight so a leaked signature is
  // only dangerous for a short window.
  const nowMs = Date.now();
  const expiresAtMs = parsed.expiresAt * 1000;
  if (expiresAtMs <= nowMs) return { authenticated: false, error: 'Payment proof expired' };
  if (expiresAtMs > nowMs + MAX_PROOF_LIFETIME_MS) {
    return { authenticated: false, error: 'Payment proof lifetime exceeds server limit' };
  }

  const authHash = buildPaymentAuthHash(context.airnode, context.endpointId, parsed.expiresAt);
  const recovered = await go(() => recoverMessageAddress({ message: { raw: authHash }, signature: parsed.signature }));
  if (!recovered.success) return { authenticated: false, error: 'Invalid payment proof signature' };
  if (!ADDRESS_REGEX.test(recovered.data)) return { authenticated: false, error: 'Unrecognised signer address' };
  const payer = recovered.data;

  const normalizedHash = parsed.txHash.toLowerCase();
  if (usedPaymentProofs.has(normalizedHash)) return { authenticated: false, error: 'Payment proof already used' };

  // Reserve immediately to prevent race conditions. If the store is full of
  // still-live entries the reservation is refused rather than evicting a
  // legitimate proof — fail closed rather than opening a replay window.
  const reserved = usedPaymentProofs.set(normalizedHash, { usedAt: Date.now() });
  if (!reserved) {
    return { authenticated: false, error: 'Replay cache full — retry shortly' };
  }

  const valid = await verifyPayment(config.rpc, parsed.txHash, config.token, config.amount, config.recipient, payer);
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

async function checkMethod(request: Request, context: AuthContext, method: ClientAuthMethod): Promise<AuthResult> {
  if (method.type === 'free') return { authenticated: true };
  if (method.type === 'apiKey') return checkApiKey(request, method.keys);
  return checkX402(request, context, method);
}

async function authenticateRequest(request: Request, context: AuthContext, auth?: ClientAuth): Promise<AuthResult> {
  const methods = normalizeAuth(auth);

  // eslint-disable-next-line functional/no-let
  let lastResult: AuthResult = { authenticated: false, error: 'Unauthorized' };

  // eslint-disable-next-line functional/no-loop-statements
  for (const method of methods) {
    const result = await checkMethod(request, context, method);
    if (result.authenticated) return result;
    lastResult = result;
  }

  return lastResult;
}

export { authenticateRequest, buildPaymentAuthHash, isPaymentRequired, setRpcClientFactory };
export type { AuthContext, AuthPaymentRequired, AuthResult, RpcClient };
