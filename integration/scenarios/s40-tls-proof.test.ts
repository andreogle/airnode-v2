import type { Server } from 'bun';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Api } from '../../src/types';
import { createTestServer, findEndpointId, post } from '../helpers';
import type { TestContext } from '../helpers';

// =============================================================================
// S40 — TLS proof gateway flow (mock Reclaim gateway)
//
// When `settings.proof` is a reclaim gateway and the endpoint declares
// `responseMatches`, the pipeline asks the gateway for an attestation of the
// upstream call and attaches it to the signed response. A gateway response that
// attests a *different* request is rejected — and because proofs are non-fatal,
// the response still comes back 200, just without the `proof` field.
// =============================================================================

// Mock Reclaim gateway. POST /good echoes the url/method the airnode sent back
// in claim.parameters (a well-formed proof); POST /bad attests an attacker URL.
function fakeReclaimProof(url: string, method: string): unknown {
  return {
    claim: {
      provider: 'http',
      parameters: JSON.stringify({ url, method }),
      context: '{}',
      owner: '0x0000000000000000000000000000000000000001',
      timestampS: Math.floor(Date.now() / 1000),
      epoch: 1,
      identifier: `0x${'11'.repeat(32)}`,
    },
    signatures: {
      attestorAddress: '0x0000000000000000000000000000000000000002',
      claimSignature: `0x${'ab'.repeat(65)}`,
    },
  };
}

function startMockGateway(): Server<undefined> {
  return Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      const sent = (await request.json()) as { url: string; method: string };
      if (url.pathname !== '/good' && url.pathname !== '/bad') return new Response('not found', { status: 404 });
      const attestedUrl = url.pathname === '/bad' ? 'https://attacker.example.com/x' : sent.url;
      return Response.json(fakeReclaimProof(attestedUrl, sent.method));
    },
  });
}

function withResponseMatches(apis: readonly Api[]): Api[] {
  return apis.map((api) =>
    api.name === 'WeatherAPI'
      ? {
          ...api,
          endpoints: api.endpoints.map((endpoint) =>
            endpoint.name === 'currentTemp'
              ? { ...endpoint, responseMatches: [{ type: 'regex' as const, value: 'temp_c' }] }
              : endpoint
          ),
        }
      : api
  );
}

let gateway: Server<undefined>;

beforeAll(() => {
  gateway = startMockGateway();
});

afterAll(() => {
  void gateway.stop();
});

describe('S40 — TLS proof gateway flow', () => {
  test('attaches a valid gateway proof to the signed response', async () => {
    const gatewayUrl = `http://127.0.0.1:${String(gateway.port)}/good`;
    const ctx: TestContext = await createTestServer({
      settings: { proof: { type: 'reclaim', gatewayUrl, timeout: 5000 } },
      apiOverrides: withResponseMatches,
    });

    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    const response = await post(ctx.baseUrl, endpointId, { q: 'London' });
    const body = (await response.json()) as {
      data: string;
      signature: string;
      proof?: { claim: { parameters: string }; signatures: { attestorAddress: string } };
    };

    expect(response.status).toBe(200);
    expect(body.signature).toMatch(/^0x/);
    expect(body.proof).toBeDefined();
    expect(body.proof?.signatures.attestorAddress).toBe('0x0000000000000000000000000000000000000002');
    // The gateway echoed the exact upstream URL the airnode attested.
    const attested = JSON.parse(body.proof?.claim.parameters ?? '{}') as { url: string };
    expect(attested.url).toContain('/current.json');

    ctx.stop();
  });

  test('drops a gateway proof that attests a different request (non-fatal)', async () => {
    const gatewayUrl = `http://127.0.0.1:${String(gateway.port)}/bad`;
    const ctx: TestContext = await createTestServer({
      settings: { proof: { type: 'reclaim', gatewayUrl, timeout: 5000 } },
      apiOverrides: withResponseMatches,
    });

    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    const response = await post(ctx.baseUrl, endpointId, { q: 'London' });
    const body = (await response.json()) as { data: string; signature: string; proof?: unknown };

    expect(response.status).toBe(200);
    expect(body.signature).toMatch(/^0x/);
    expect(body.proof).toBeUndefined();

    ctx.stop();
  });
});
