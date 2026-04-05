/**
 * Reclaim Protocol TLS Proof Spike
 *
 * Calls CoinGecko through a Reclaim attestor and measures:
 * 1. Can we get a signed proof of the API response?
 * 2. Can we redact the API key from the proof?
 * 3. What's the latency overhead?
 * 4. Can we extract specific JSON fields?
 *
 * Usage:
 *   docker compose up -d
 *   node --import=./init-crypto.mjs --experimental-strip-types prove.ts
 *   node --import=./init-crypto.mjs --experimental-strip-types prove.ts --redact
 */
import { writeFileSync } from 'node:fs';
import { generatePrivateKey } from 'viem/accounts';

// =============================================================================
// Config
// =============================================================================
const ATTESTOR_URL = process.env.ATTESTOR_URL ?? 'ws://localhost:8001/ws';
const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd';
const REDACT = process.argv.includes('--redact');

// =============================================================================
// Helpers
// =============================================================================
function elapsed(startMs: number): string {
  return `${((Date.now() - startMs) / 1000).toFixed(2)}s`;
}

// =============================================================================
// Main
// =============================================================================
async function main(): Promise<void> {
  // Crypto is initialized via --import=./init-crypto.mjs preload.
  // attestor-core and zk-symmetric-crypto both use ESM `import { crypto } from
  // '@reclaimprotocol/tls'` — the preload populates that shared ESM module instance.
  const { createClaimOnAttestor } = await import('@reclaimprotocol/attestor-core');
  console.log('--- Reclaim TLS Proof Spike ---');
  console.log(`Attestor:  ${ATTESTOR_URL}`);
  console.log(`API URL:   ${COINGECKO_URL}`);
  console.log(`Redaction: ${REDACT ? 'yes (fake API key in header)' : 'no'}`);
  console.log();

  // Generate a throwaway owner key for this spike
  const ownerPrivateKey = generatePrivateKey();

  // Build the request parameters
  const params = {
    url: COINGECKO_URL,
    method: 'GET' as const,
    responseMatches: [
      {
        type: 'regex' as const,
        // Extract the USD price of ETH using a named capture group
        value: '"usd":\\s*(?<price>[\\d.]+)',
      },
    ],
    responseRedactions: [
      {
        // Only reveal the JSON body (redact HTTP headers from attestor view)
        jsonPath: 'ethereum.usd',
      },
    ],
    // If testing redaction, add a non-secret header so we can compare
    ...(REDACT ? { headers: { 'X-Public-Header': 'visible-to-attestor' } } : {}),
  };

  // Secret params — these are redacted from the proof.
  // The HTTP provider requires at least one auth parameter (cookie or header).
  const secretParams = REDACT
    ? {
        headers: {
          'x-cg-pro-api-key': 'fake-secret-key-for-redaction-test',
        },
      }
    : {
        // CoinGecko public API doesn't need auth, but the provider requires
        // at least one secret header. Use a benign one.
        cookieStr: '',
        authorisationHeader: 'Bearer none',
      };

  console.log('Creating claim on attestor...');
  const startMs = Date.now();

  try {
    const result = await createClaimOnAttestor({
      name: 'http',
      params,
      secretParams,
      ownerPrivateKey,
      client: { url: ATTESTOR_URL },
      onStep: (step) => {
        console.log(`  [${elapsed(startMs)}] Step: ${step.name}${'proofsDone' in step ? ` (${step.proofsDone}/${step.proofsTotal})` : ''}`);
      },
    });

    const totalTime = elapsed(startMs);

    console.log();
    console.log(`=== RESULT (${totalTime}) ===`);
    console.log();

    // Log the claim data
    if (result.claim) {
      console.log('Claim:');
      console.log(`  Provider:    ${result.claim.provider}`);
      console.log(`  Parameters:  ${result.claim.parameters}`);
      console.log(`  Owner:       ${result.claim.owner}`);
      console.log(`  Timestamp:   ${result.claim.timestampS}`);
      console.log(`  Epoch:       ${result.claim.epoch}`);
      console.log(`  Identifier:  ${result.claim.identifier}`);
      console.log(`  Context:     ${result.claim.context}`);
    }

    // Log signatures
    if (result.signatures) {
      console.log();
      console.log('Signatures:');
      const sigs = result.signatures?.claimSignatures ?? result.signatures;
      console.log(`  Count: ${Array.isArray(sigs) ? sigs.length : 'unknown'}`);
      console.log(`  Raw:   ${JSON.stringify(result.signatures).slice(0, 200)}...`);
    }

    // Check for extracted parameters (from regex named groups)
    try {
      const context = result.claim?.context ? JSON.parse(result.claim.context) : {};
      if (context.extractedParameters) {
        console.log();
        console.log('Extracted parameters:');
        for (const [key, value] of Object.entries(context.extractedParameters)) {
          console.log(`  ${key}: ${value}`);
        }
      }
    } catch {
      // context might not be valid JSON
    }

    // Check if the API key is visible anywhere in the proof
    if (REDACT) {
      const proofStr = JSON.stringify(result);
      const keyVisible = proofStr.includes('fake-secret-key-for-redaction-test');
      console.log();
      console.log(`API key redaction: ${keyVisible ? 'FAILED - key visible in proof!' : 'PASSED - key not in proof'}`);
    }

    // Write full result for inspection
    const outputPath = './proof-result.json';
    writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log();
    console.log(`Full result written to ${outputPath}`);
  } catch (error) {
    console.error();
    console.error(`FAILED after ${elapsed(startMs)}`);
    console.error(error);
    process.exit(1);
  }
}

main();
