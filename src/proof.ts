import { go } from '@api3/promise-utils';
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
const PROOF_TIMEOUT_MS = 30_000;

async function requestProof(gatewayUrl: string, request: ProofRequest): Promise<ReclaimProof> {
  logger.debug(`Requesting TLS proof from ${gatewayUrl}`);

  const result = await go(async () => {
    const response = await fetch(gatewayUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(PROOF_TIMEOUT_MS),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Proof gateway returned ${String(response.status)}: ${text}`);
    }

    return response.json() as Promise<ReclaimProof>;
  });

  if (!result.success) {
    logger.error(`TLS proof request failed: ${result.error.message}`);
    throw result.error;
  }

  logger.debug(`TLS proof received from attestor ${result.data.signatures.attestorAddress}`);
  return result.data;
}

export { requestProof };
export type { ProofRequest, ReclaimClaim, ReclaimProof };
