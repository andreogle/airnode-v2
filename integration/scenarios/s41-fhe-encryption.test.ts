import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { hexToBytes } from 'viem';
import type { Api } from '../../src/types';
import { createTestServer, findEndpointId, post } from '../helpers';
import type { TestContext } from '../helpers';

// =============================================================================
// S41 — FHE-encrypted response end-to-end (mock Zama relayer SDK)
//
// When an endpoint is configured with `encrypt`, the ABI-encoded integer is
// replaced — before signing — with `abi.encode(bytes32 handle, bytes proof)`
// produced via the Zama relayer. The relayer SDK is mocked so the encryption
// step is deterministic; the signature still covers whatever the encrypt step
// produced.
// =============================================================================

const CONSUMER_CONTRACT = '0x1111111111111111111111111111111111111111';
const FHE_VERIFIER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

// Deterministic stand-in for @zama-fhe/relayer-sdk/node — handle 0xab…ab (32B),
// proof 0xdeadbeef. fhe.ts imports it lazily, so this is in place by the time a
// request hits the encrypt step.
void mock.module('@zama-fhe/relayer-sdk/node', () => ({
  SepoliaConfig: { relayerUrl: 'https://relayer.testnet.zama.cloud' },
  MainnetConfig: { relayerUrl: 'https://relayer.mainnet.zama.cloud' },
  createInstance: () =>
    Promise.resolve({
      createEncryptedInput: () => {
        const builder = {
          add8: () => builder,
          add16: () => builder,
          add32: () => builder,
          add64: () => builder,
          add128: () => builder,
          add256: () => builder,
          encrypt: () =>
            Promise.resolve({ handles: [hexToBytes(`0x${'ab'.repeat(32)}`)], inputProof: hexToBytes('0xdeadbeef') }),
        };
        return builder;
      },
    }),
}));

// abi.encode(bytes32 0xab…ab, bytes 0xdeadbeef)
const EXPECTED_CIPHERTEXT =
  '0xabababababababababababababababababababababababababababababababab00000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000004deadbeef00000000000000000000000000000000000000000000000000000000';

function withEncryptedEndpoint(apis: readonly Api[]): Api[] {
  return apis.map((api) =>
    api.name === 'WeatherAPI'
      ? {
          ...api,
          endpoints: api.endpoints.map((endpoint) =>
            endpoint.name === 'currentTemp'
              ? { ...endpoint, encrypt: { type: 'euint64' as const, contract: CONSUMER_CONTRACT } }
              : endpoint
          ),
        }
      : api
  );
}

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestServer({
    settings: {
      fhe: { network: 'sepolia', rpcUrl: 'https://eth-sepolia.example.com', verifier: FHE_VERIFIER },
    },
    apiOverrides: withEncryptedEndpoint,
  });
});

afterAll(() => {
  ctx.stop();
});

describe('S41 — FHE-encrypted response', () => {
  test('signed response carries the FHE ciphertext instead of the plaintext-encoded value', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    const response = await post(ctx.baseUrl, endpointId, { q: 'London' });
    const body = (await response.json()) as { endpointId: string; data: string; signature: string };

    expect(response.status).toBe(200);
    expect(body.endpointId).toBe(endpointId);
    expect(body.data).toBe(EXPECTED_CIPHERTEXT);
    // It is NOT the plain int256 encoding of 22.5 * 100 = 2250 (0x…08ca).
    expect(body.data).not.toBe('0x00000000000000000000000000000000000000000000000000000000000008ca');
    expect(body.signature).toMatch(/^0x[\da-f]+$/);
  });
});
