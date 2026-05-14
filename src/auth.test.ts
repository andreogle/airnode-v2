import { afterEach, describe, expect, test } from 'bun:test';
import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { authenticateRequest, buildPaymentAuthHash, isPaymentRequired, setRpcClientFactory } from './auth';
import type { AuthContext, AuthResult, RpcClient } from './auth';
import type { ClientAuth } from './types';

const TEST_AIRNODE: Hex = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const TEST_ENDPOINT_ID: Hex = '0x04e77a11d6561a70385e2e8e315989cb24bb35128cb4d5a8b3ece93a3c72295b';
const CTX: AuthContext = { airnode: TEST_AIRNODE, endpointId: TEST_ENDPOINT_ID };

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://test', { headers });
}

function expectError(result: AuthResult): string {
  expect(result.authenticated).toBe(false);
  if ('error' in result) return result.error;
  return 'payment required';
}

// =============================================================================
// Free and API key auth
// =============================================================================
describe('authenticateRequest', () => {
  test('returns authenticated for undefined auth', async () => {
    const result = await authenticateRequest(makeRequest(), CTX);
    expect(result.authenticated).toBe(true);
  });

  test('returns authenticated for free auth', async () => {
    const result = await authenticateRequest(makeRequest(), CTX, { type: 'free' });
    expect(result.authenticated).toBe(true);
  });

  test('returns authenticated for valid API key', async () => {
    const auth: ClientAuth = { type: 'apiKey', keys: ['valid-key'] };
    const result = await authenticateRequest(makeRequest({ 'X-Api-Key': 'valid-key' }), CTX, auth);
    expect(result.authenticated).toBe(true);
  });

  test('returns error for missing API key header', async () => {
    const auth: ClientAuth = { type: 'apiKey', keys: ['valid-key'] };
    const result = await authenticateRequest(makeRequest(), CTX, auth);
    const error = expectError(result);
    expect(error).toBe('Missing X-Api-Key header');
  });

  test('returns error for invalid API key', async () => {
    const auth: ClientAuth = { type: 'apiKey', keys: ['valid-key'] };
    const result = await authenticateRequest(makeRequest({ 'X-Api-Key': 'wrong-key' }), CTX, auth);
    const error = expectError(result);
    expect(error).toBe('Invalid API key');
  });

  test('supports multiple valid keys', async () => {
    const auth: ClientAuth = { type: 'apiKey', keys: ['key-1', 'key-2', 'key-3'] };

    const r1 = await authenticateRequest(makeRequest({ 'X-Api-Key': 'key-1' }), CTX, auth);
    expect(r1.authenticated).toBe(true);

    const r2 = await authenticateRequest(makeRequest({ 'X-Api-Key': 'key-3' }), CTX, auth);
    expect(r2.authenticated).toBe(true);

    const r3 = await authenticateRequest(makeRequest({ 'X-Api-Key': 'key-4' }), CTX, auth);
    expect(r3.authenticated).toBe(false);
  });
});

// =============================================================================
// Multi-method auth
// =============================================================================
describe('multi-method auth', () => {
  test('array with free method always succeeds', async () => {
    const auth: ClientAuth = [{ type: 'apiKey', keys: ['key'] }, { type: 'free' }];
    const result = await authenticateRequest(makeRequest(), CTX, auth);
    expect(result.authenticated).toBe(true);
  });

  test('array succeeds if any method passes', async () => {
    const auth: ClientAuth = [
      { type: 'apiKey', keys: ['key-1'] },
      { type: 'apiKey', keys: ['key-2'] },
    ];
    const result = await authenticateRequest(makeRequest({ 'X-Api-Key': 'key-2' }), CTX, auth);
    expect(result.authenticated).toBe(true);
  });

  test('array fails if no method passes', async () => {
    const auth: ClientAuth = [
      { type: 'apiKey', keys: ['key-1'] },
      { type: 'apiKey', keys: ['key-2'] },
    ];
    const result = await authenticateRequest(makeRequest({ 'X-Api-Key': 'wrong' }), CTX, auth);
    expect(result.authenticated).toBe(false);
  });

  test('endpoint-level auth overrides API-level', async () => {
    const apiAuth: ClientAuth = { type: 'apiKey', keys: ['api-key'] };
    const resolveAuth = (endpointAuth?: ClientAuth): ClientAuth | undefined => endpointAuth ?? apiAuth;

    const r1 = await authenticateRequest(makeRequest(), CTX, resolveAuth({ type: 'free' }));
    expect(r1.authenticated).toBe(true);

    const r2 = await authenticateRequest(makeRequest(), CTX, resolveAuth());
    expect(r2.authenticated).toBe(false);
  });
});

// =============================================================================
// buildPaymentAuthHash
// =============================================================================
describe('buildPaymentAuthHash', () => {
  test('is keccak256(encodePacked(address, bytes32, uint64))', () => {
    // Exact value — would catch a reordering or width change of the packed fields.
    expect(buildPaymentAuthHash(TEST_AIRNODE, TEST_ENDPOINT_ID, 1_700_000_000)).toBe(
      '0xa70bc4844af62398e0430abe64012b242c29fa170789ec99baa94223eb24628e'
    );
  });

  test('binds to airnode, endpointId, and expiresAt independently', () => {
    const base = buildPaymentAuthHash(TEST_AIRNODE, TEST_ENDPOINT_ID, 1_700_000_000);
    expect(
      buildPaymentAuthHash('0x0000000000000000000000000000000000000001', TEST_ENDPOINT_ID, 1_700_000_000)
    ).not.toBe(base);
    expect(buildPaymentAuthHash(TEST_AIRNODE, `0x${'00'.repeat(32)}`, 1_700_000_000)).not.toBe(base);
    expect(buildPaymentAuthHash(TEST_AIRNODE, TEST_ENDPOINT_ID, 1_700_000_001)).not.toBe(base);
  });
});

// =============================================================================
// x402 payment auth
//
// verifyPayment talks to an RPC node; tests inject a fake client via
// setRpcClientFactory so the on-chain checks are exercised deterministically.
// =============================================================================
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ETH_ZERO = '0x0000000000000000000000000000000000000000';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const RECIPIENT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const PAYER_KEY: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const payerAccount = privateKeyToAccount(PAYER_KEY);

interface FakeRpcOptions {
  readonly receiptStatus?: 'success' | 'reverted';
  readonly receiptLogs?: readonly { address: string; topics: readonly string[]; data: string }[];
  readonly blockTimestamp?: bigint;
  readonly txFrom?: string;
  readonly txTo?: string | null;
  readonly txValue?: bigint;
  readonly receiptFails?: boolean;
}

function fakeRpc(options: FakeRpcOptions = {}): RpcClient {
  return {
    getTransactionReceipt: () =>
      options.receiptFails
        ? Promise.reject(new Error('rpc unavailable'))
        : Promise.resolve({
            status: options.receiptStatus ?? 'success',
            blockNumber: 16n,
            logs: options.receiptLogs ?? [],
          }),
    getBlock: () => Promise.resolve({ timestamp: options.blockTimestamp ?? BigInt(Math.floor(Date.now() / 1000)) }),
    getTransaction: () =>
      Promise.resolve({
        from: options.txFrom ?? payerAccount.address,
        to: options.txTo ?? RECIPIENT,
        value: options.txValue ?? 1_000_000n,
      }),
  };
}

function transferLog(
  to: string,
  value: bigint,
  token = USDC
): { address: string; topics: readonly string[]; data: string } {
  return {
    address: token,
    topics: [
      TRANSFER_TOPIC,
      `0x${payerAccount.address.slice(2).padStart(64, '0')}`,
      `0x${to.slice(2).padStart(64, '0')}`,
    ],
    data: `0x${value.toString(16)}`,
  };
}

async function makeSignedProof(
  overrides: {
    readonly txHash?: Hex;
    readonly expiresAt?: number;
    readonly airnode?: Hex;
    readonly endpointId?: Hex;
  } = {}
): Promise<string> {
  const txHash = overrides.txHash ?? `0x${'ab'.repeat(32)}`;
  const expiresAt = overrides.expiresAt ?? Math.floor(Date.now() / 1000) + 120;
  const airnode = overrides.airnode ?? CTX.airnode;
  const endpointId = overrides.endpointId ?? CTX.endpointId;
  const hash = buildPaymentAuthHash(airnode, endpointId, expiresAt);
  const signature = await payerAccount.signMessage({ message: { raw: hash } });
  return JSON.stringify({ txHash, expiresAt, signature });
}

const proofHeader = (proof: string): Record<string, string> => ({ 'X-Payment-Proof': proof });

describe('x402 auth', () => {
  const x402Config: ClientAuth = {
    type: 'x402',
    network: 8453,
    rpc: 'http://localhost:8545',
    token: ETH_ZERO,
    amount: '1000000',
    recipient: RECIPIENT,
    expiry: 300_000,
  };
  const erc20Config: ClientAuth = { ...x402Config, token: USDC };

  afterEach(() => {
    setRpcClientFactory(); // restore the real (viem http) factory
  });

  // ---------------------------------------------------------------------------
  // 402 challenge + proof-parsing / expiry validation (no RPC involved)
  // ---------------------------------------------------------------------------
  test('returns 402 with the full payment details when no proof header', async () => {
    const result = await authenticateRequest(makeRequest(), CTX, x402Config);

    expect(result.authenticated).toBe(false);
    expect(isPaymentRequired(result)).toBe(true);
    if (!isPaymentRequired(result)) throw new Error('expected paymentRequired');
    expect(result.paymentDetails.airnode).toBe(CTX.airnode);
    expect(result.paymentDetails.endpointId).toBe(CTX.endpointId);
    expect(result.paymentDetails.amount).toBe('1000000');
    expect(result.paymentDetails.token).toBe(ETH_ZERO);
    expect(result.paymentDetails.network).toBe(8453);
    expect(result.paymentDetails.recipient).toBe(RECIPIENT);
    expect(result.paymentDetails.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  test('rejects non-JSON X-Payment-Proof', async () => {
    const result = await authenticateRequest(makeRequest(proofHeader('0xdeadbeef')), CTX, x402Config);
    expect(expectError(result)).toBe('X-Payment-Proof must be a JSON object');
  });

  test('rejects a malformed tx hash in the proof', async () => {
    const proof = JSON.stringify({
      txHash: '0xdeadbeef',
      expiresAt: Math.floor(Date.now() / 1000) + 120,
      signature: `0x${'ab'.repeat(65)}`,
    });
    const result = await authenticateRequest(makeRequest(proofHeader(proof)), CTX, x402Config);
    expect(expectError(result)).toBe('Invalid txHash in payment proof');
  });

  test('rejects an expired payment proof', async () => {
    const proof = await makeSignedProof({ expiresAt: Math.floor(Date.now() / 1000) - 10 });
    const result = await authenticateRequest(makeRequest(proofHeader(proof)), CTX, x402Config);
    expect(expectError(result)).toBe('Payment proof expired');
  });

  test('rejects a proof whose lifetime exceeds the server limit', async () => {
    const proof = await makeSignedProof({ expiresAt: Math.floor(Date.now() / 1000) + 60 * 60 });
    const result = await authenticateRequest(makeRequest(proofHeader(proof)), CTX, x402Config);
    expect(expectError(result)).toBe('Payment proof lifetime exceeds server limit');
  });

  test('rejects a tampered signature before any RPC call', async () => {
    const signed = await makeSignedProof();
    const proof = signed.replace(/"signature":"0x[^"]+"/, '"signature":"0xdeadbeef"');
    const result = await authenticateRequest(makeRequest(proofHeader(proof)), CTX, x402Config);
    expect(expectError(result)).toBe('Invalid payment proof signature');
  });

  // ---------------------------------------------------------------------------
  // On-chain payment verification (fake RPC client)
  // ---------------------------------------------------------------------------
  test('authenticates a valid ETH payment', async () => {
    setRpcClientFactory(() => fakeRpc({ txTo: RECIPIENT, txValue: 1_000_000n }));
    const proof = await makeSignedProof({ txHash: `0x${'01'.repeat(32)}` });
    const result = await authenticateRequest(makeRequest(proofHeader(proof)), CTX, x402Config);
    expect(result.authenticated).toBe(true);
  });

  test('rejects an ETH payment to the wrong recipient', async () => {
    setRpcClientFactory(() => fakeRpc({ txTo: '0x000000000000000000000000000000000000dEaD', txValue: 1_000_000n }));
    const proof = await makeSignedProof({ txHash: `0x${'02'.repeat(32)}` });
    const result = await authenticateRequest(makeRequest(proofHeader(proof)), CTX, x402Config);
    expect(expectError(result)).toBe('Payment verification failed');
  });

  test('rejects an ETH payment below the required amount', async () => {
    setRpcClientFactory(() => fakeRpc({ txTo: RECIPIENT, txValue: 999_999n }));
    const proof = await makeSignedProof({ txHash: `0x${'03'.repeat(32)}` });
    const result = await authenticateRequest(makeRequest(proofHeader(proof)), CTX, x402Config);
    expect(expectError(result)).toBe('Payment verification failed');
  });

  test('rejects a reverted transaction', async () => {
    setRpcClientFactory(() => fakeRpc({ receiptStatus: 'reverted', txTo: RECIPIENT, txValue: 1_000_000n }));
    const proof = await makeSignedProof({ txHash: `0x${'04'.repeat(32)}` });
    const result = await authenticateRequest(makeRequest(proofHeader(proof)), CTX, x402Config);
    expect(expectError(result)).toBe('Payment verification failed');
  });

  test('rejects a transaction older than the recency window', async () => {
    setRpcClientFactory(() =>
      fakeRpc({ blockTimestamp: BigInt(Math.floor(Date.now() / 1000) - 3600), txTo: RECIPIENT })
    );
    const proof = await makeSignedProof({ txHash: `0x${'05'.repeat(32)}` });
    const result = await authenticateRequest(makeRequest(proofHeader(proof)), CTX, x402Config);
    expect(expectError(result)).toBe('Payment verification failed');
  });

  test('rejects when the transaction sender is not the proof signer', async () => {
    setRpcClientFactory(() => fakeRpc({ txFrom: '0x000000000000000000000000000000000000bEEF', txTo: RECIPIENT }));
    const proof = await makeSignedProof({ txHash: `0x${'06'.repeat(32)}` });
    const result = await authenticateRequest(makeRequest(proofHeader(proof)), CTX, x402Config);
    expect(expectError(result)).toBe('Payment verification failed');
  });

  test('rejects a signature bound to a different airnode (recovers to a non-payer address)', async () => {
    setRpcClientFactory(() => fakeRpc({ txTo: RECIPIENT, txValue: 1_000_000n }));
    const proof = await makeSignedProof({
      txHash: `0x${'07'.repeat(32)}`,
      airnode: '0x0000000000000000000000000000000000000001',
    });
    const result = await authenticateRequest(makeRequest(proofHeader(proof)), CTX, x402Config);
    expect(expectError(result)).toBe('Payment verification failed');
  });

  test('authenticates a valid ERC-20 payment via the Transfer log', async () => {
    setRpcClientFactory(() => fakeRpc({ receiptLogs: [transferLog(RECIPIENT, 1_000_000n)] }));
    const proof = await makeSignedProof({ txHash: `0x${'08'.repeat(32)}` });
    const result = await authenticateRequest(makeRequest(proofHeader(proof)), CTX, erc20Config);
    expect(result.authenticated).toBe(true);
  });

  test('rejects an ERC-20 Transfer log from a different token contract', async () => {
    setRpcClientFactory(() =>
      fakeRpc({ receiptLogs: [transferLog(RECIPIENT, 1_000_000n, '0x000000000000000000000000000000000000FFFF')] })
    );
    const proof = await makeSignedProof({ txHash: `0x${'09'.repeat(32)}` });
    const result = await authenticateRequest(makeRequest(proofHeader(proof)), CTX, erc20Config);
    expect(expectError(result)).toBe('Payment verification failed');
  });

  // ---------------------------------------------------------------------------
  // Replay protection
  // ---------------------------------------------------------------------------
  test('rejects reuse of a txHash that already authenticated a request', async () => {
    setRpcClientFactory(() => fakeRpc({ txTo: RECIPIENT, txValue: 1_000_000n }));
    const proof = await makeSignedProof({ txHash: `0x${'0a'.repeat(32)}` });

    const first = await authenticateRequest(makeRequest(proofHeader(proof)), CTX, x402Config);
    expect(first.authenticated).toBe(true);

    const second = await authenticateRequest(makeRequest(proofHeader(proof)), CTX, x402Config);
    expect(expectError(second)).toBe('Payment proof already used');
  });

  test('does not consume the txHash when verification fails (a later valid attempt succeeds)', async () => {
    const txHash: Hex = `0x${'0b'.repeat(32)}`;

    setRpcClientFactory(() => fakeRpc({ receiptFails: true }));
    const failed = await authenticateRequest(
      makeRequest(proofHeader(await makeSignedProof({ txHash }))),
      CTX,
      x402Config
    );
    expect(expectError(failed)).toBe('Payment verification failed');

    setRpcClientFactory(() => fakeRpc({ txTo: RECIPIENT, txValue: 1_000_000n }));
    const retried = await authenticateRequest(
      makeRequest(proofHeader(await makeSignedProof({ txHash }))),
      CTX,
      x402Config
    );
    expect(retried.authenticated).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Multi-method
  // ---------------------------------------------------------------------------
  test('x402 in a multi-method array falls through to the next method', async () => {
    const auth: ClientAuth = [x402Config, { type: 'apiKey', keys: ['backup-key'] }];

    const r1 = await authenticateRequest(makeRequest(), CTX, auth);
    expect(r1.authenticated).toBe(false); // x402 → paymentRequired, apiKey → missing header

    const r2 = await authenticateRequest(makeRequest({ 'X-Api-Key': 'backup-key' }), CTX, auth);
    expect(r2.authenticated).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Per-IP rate limit on verification attempts (RPC-DoS guard)
  // ---------------------------------------------------------------------------
  test('rate-limits x402 verification attempts per client IP', async () => {
    // Use a payer-mismatch failure (not receiptFails) so each attempt returns
    // immediately without burning RPC retry delays — keeps the test sub-second.
    setRpcClientFactory(() => fakeRpc({ txFrom: '0x000000000000000000000000000000000000bEEF', txTo: RECIPIENT }));
    const ipCtx: AuthContext = { ...CTX, clientIp: '203.0.113.42' }; // a fresh IP, so the bucket is full

    // Burn through the per-IP budget. Each call fails verification (not rate-limit) and consumes a token.
    for (let i = 0; i < 30; i++) {
      const txHash: Hex = `0x${i.toString(16).padStart(64, '0')}`;
      const proof = await makeSignedProof({ txHash });
      const r = await authenticateRequest(makeRequest(proofHeader(proof)), ipCtx, x402Config);
      expect(expectError(r)).toBe('Payment verification failed');
    }

    // The next attempt is gated by the bucket before it ever hits the (fake) RPC.
    const overflowProof = await makeSignedProof({ txHash: `0x${'ff'.repeat(32)}` });
    const blocked = await authenticateRequest(makeRequest(proofHeader(overflowProof)), ipCtx, x402Config);
    expect(expectError(blocked)).toBe('Too many x402 verification attempts — slow down');

    // A different IP has its own bucket — not affected.
    const otherIpCtx: AuthContext = { ...CTX, clientIp: '203.0.113.99' };
    setRpcClientFactory(() => fakeRpc({ txTo: RECIPIENT, txValue: 1_000_000n }));
    const stillOkProof = await makeSignedProof({ txHash: `0x${'cc'.repeat(32)}` });
    const ok = await authenticateRequest(makeRequest(proofHeader(stillOkProof)), otherIpCtx, x402Config);
    expect(ok.authenticated).toBe(true);
  });
});
