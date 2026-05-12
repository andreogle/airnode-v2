import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Api } from '../../src/types';
import { createTestServer, findEndpointId, post } from '../helpers';
import type { TestContext } from '../helpers';

// =============================================================================
// S39 — x402 payment challenge + proof rejection (no chain interaction)
//
// An x402-protected endpoint answers an unpaid request with HTTP 402 and the
// payment parameters the client must satisfy, and rejects a malformed
// X-Payment-Proof header before it ever touches an RPC node. (The on-chain
// verification path — receipt status, recency, payer-signature binding,
// replay — is covered by the auth unit tests.)
// =============================================================================
const RECIPIENT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const TOKEN = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

function makeX402Endpoint(apis: readonly Api[]): Api[] {
  return apis.map((api) =>
    api.name === 'WeatherAPI'
      ? {
          ...api,
          endpoints: api.endpoints.map((endpoint) =>
            endpoint.name === 'currentTemp'
              ? {
                  ...endpoint,
                  auth: {
                    type: 'x402' as const,
                    network: 8453,
                    rpc: 'http://127.0.0.1:9/unused',
                    token: TOKEN,
                    amount: '1000000',
                    recipient: RECIPIENT,
                    expiry: 300_000,
                  },
                }
              : endpoint
          ),
        }
      : api
  );
}

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestServer({ apiOverrides: makeX402Endpoint });
});

afterAll(() => {
  ctx.stop();
});

describe('S39 — x402 payment challenge', () => {
  test('an unpaid request gets 402 with the payment parameters', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    const response = await post(ctx.baseUrl, endpointId, { q: 'London' });

    expect(response.status).toBe(402);
    const details = (await response.json()) as {
      airnode: string;
      endpointId: string;
      amount: string;
      token: string;
      network: number;
      recipient: string;
      expiresAt: number;
    };
    expect(details.endpointId).toBe(endpointId);
    expect(details.amount).toBe('1000000');
    expect(details.token).toBe(TOKEN);
    expect(details.network).toBe(8453);
    expect(details.recipient).toBe(RECIPIENT);
    expect(details.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  test('a non-JSON X-Payment-Proof header is rejected with 401', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    const response = await post(ctx.baseUrl, endpointId, { q: 'London' }, { 'X-Payment-Proof': 'not-json-at-all' });

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('X-Payment-Proof must be a JSON object');
  });

  test('a structurally invalid payment proof is rejected with 401', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    const proof = JSON.stringify({
      txHash: '0xdeadbeef',
      expiresAt: Math.floor(Date.now() / 1000) + 60,
      signature: '0xabc',
    });
    const response = await post(ctx.baseUrl, endpointId, { q: 'London' }, { 'X-Payment-Proof': proof });

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('Invalid txHash in payment proof');
  });
});
