import { isDeepStrictEqual } from 'node:util';
import { go, goSync } from '@api3/promise-utils';
import { logger } from './logger';

// =============================================================================
// Types
// =============================================================================
interface ReclaimClaim {
  readonly provider: string;
  readonly parameters: string;
  readonly context: string;
  readonly owner: string;
  readonly timestampS: number;
  readonly epoch: number;
  readonly identifier: string;
}

interface ReclaimProof {
  readonly claim: ReclaimClaim;
  readonly signatures: {
    readonly attestorAddress: string;
    readonly claimSignature: string;
  };
}

interface ProofRequest {
  readonly url: string;
  readonly method: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly responseMatches?: readonly { readonly type: string; readonly value: string }[];
  readonly responseRedactions?: readonly { readonly jsonPath?: string }[];
}

// =============================================================================
// Proof gateway client
// =============================================================================
const DEFAULT_PROOF_TIMEOUT_MS = 30_000;

// The gateway is untrusted in the sense that Airnode does not verify the
// attestor signature itself (the consumer does that on-chain) — but it does
// reject a response that is malformed or attests a *different* request than the
// one Airnode made, so it never forwards a proof for the wrong URL/method.
function validateProof(raw: unknown, request: ProofRequest): ReclaimProof {
  const proof = raw as {
    readonly claim?: { readonly parameters?: unknown };
    readonly signatures?: { readonly claimSignature?: unknown; readonly attestorAddress?: unknown };
  };
  if (typeof proof.claim?.parameters !== 'string') {
    throw new TypeError('proof response missing claim.parameters');
  }
  if (typeof proof.signatures?.claimSignature !== 'string') {
    throw new TypeError('proof response missing attestor signature');
  }
  if (typeof proof.signatures.attestorAddress !== 'string') {
    throw new TypeError('proof response missing attestor address');
  }

  const params = goSync(
    () =>
      JSON.parse(proof.claim?.parameters as string) as {
        url?: unknown;
        method?: unknown;
        headers?: unknown;
        body?: unknown;
        responseMatches?: unknown;
      }
  );
  if (!params.success) {
    throw new Error('proof claim.parameters is not valid JSON');
  }
  if (params.data.url !== request.url) {
    throw new Error(`proof attests URL ${String(params.data.url)}, expected ${request.url}`);
  }
  if (params.data.method !== request.method) {
    throw new Error(`proof attests method ${String(params.data.method)}, expected ${request.method}`);
  }
  const comparedFields = ['headers', 'body', 'responseMatches'] as const;
  const mismatch = comparedFields.find(
    (field) => request[field] !== undefined && !isDeepStrictEqual(params.data[field], request[field])
  );
  if (mismatch) {
    throw new Error(`proof attests different ${mismatch}`);
  }
  return raw as ReclaimProof;
}

async function requestProof(
  gatewayUrl: string,
  request: ProofRequest,
  timeoutMs: number = DEFAULT_PROOF_TIMEOUT_MS
): Promise<ReclaimProof> {
  logger.debug(`Requesting TLS proof from ${gatewayUrl}`);

  const result = await go(async () => {
    const response = await fetch(gatewayUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      // The gateway receives upstream credentials. Do not include its response
      // body in errors or logs because a misconfigured gateway may echo them.
      throw new Error(`Proof gateway returned ${String(response.status)}`);
    }

    return response.json();
  });

  if (!result.success) {
    logger.error(`TLS proof request failed: ${result.error.message}`);
    throw result.error;
  }

  const proof = validateProof(result.data, request);
  logger.debug(`TLS proof received from attestor ${proof.signatures.attestorAddress}`);
  return proof;
}

export { requestProof };
export type { ProofRequest, ReclaimClaim, ReclaimProof };
