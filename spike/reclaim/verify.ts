/**
 * Reclaim Proof Verification Spike
 *
 * Reads the proof from prove.ts and verifies it off-chain:
 * 1. Reconstruct ClaimInfo and verify the identifier hash
 * 2. Recover the signer from the ECDSA signature
 * 3. Confirm it matches the attestor's address
 *
 * Usage:
 *   node --import=./init-crypto.mjs --experimental-strip-types verify.ts
 *   node --import=./init-crypto.mjs --experimental-strip-types verify.ts ./custom-proof.json
 */
import { readFileSync } from 'node:fs';
import { keccak256, recoverAddress, toHex } from 'viem';
import { hashMessage } from 'viem';

// =============================================================================
// Types (matching Reclaim's proof structure)
// =============================================================================
interface ProviderClaimData {
  provider: string;
  parameters: string;
  context: string;
  owner: string;
  timestampS: number;
  epoch: number;
  identifier: string;
}

interface ClaimTunnelResponse {
  claim?: ProviderClaimData;
  signatures?: {
    attestorAddress?: string;
    claimSignature?: Record<string, number>;
    claimSignatures?: Array<{ signature: string; attestorAddress: string }>;
  };
}

// =============================================================================
// Verification
// =============================================================================
function computeIdentifier(claim: ProviderClaimData): string {
  // Reclaim's identifier = keccak256(provider + "\n" + parameters + "\n" + context)
  const preimage = `${claim.provider}\n${claim.parameters}\n${claim.context}`;
  return keccak256(toHex(preimage));
}

async function verifySignature(
  claim: ProviderClaimData,
  signature: string
): Promise<string> {
  // Reclaim signs: identifier + "\n" + owner + "\n" + timestampS + "\n" + epoch
  // using ETH personal sign (EIP-191)
  const signData = [
    claim.identifier,
    claim.owner.toLowerCase(),
    claim.timestampS.toString(),
    claim.epoch.toString(),
  ].join('\n');
  const recovered = await recoverAddress({
    hash: hashMessage(signData),
    signature: signature as `0x${string}`,
  });
  return recovered;
}

// =============================================================================
// Main
// =============================================================================
async function main(): Promise<void> {
  const proofPath = process.argv[2] ?? './proof-result.json';

  console.log('--- Reclaim Proof Verification ---');
  console.log(`Reading: ${proofPath}`);
  console.log();

  let result: ClaimTunnelResponse;
  try {
    const raw = readFileSync(proofPath, 'utf-8');
    result = JSON.parse(raw) as ClaimTunnelResponse;
  } catch (error) {
    console.error(`Failed to read proof file: ${proofPath}`);
    console.error('Run prove.ts first to generate a proof.');
    process.exit(1);
  }

  if (!result.claim) {
    console.error('No claim data in proof result.');
    process.exit(1);
  }

  const claim = result.claim;

  // Step 1: Verify identifier hash
  console.log('1. Verifying identifier hash...');
  const computedId = computeIdentifier(claim);
  const idMatch = computedId === claim.identifier;
  console.log(`   Computed:  ${computedId}`);
  console.log(`   Claimed:   ${claim.identifier}`);
  console.log(`   Match:     ${idMatch ? 'PASS' : 'FAIL'}`);
  console.log();

  // Step 2: Verify signatures
  // The response may have { attestorAddress, claimSignature: {0: byte, 1: byte, ...} }
  // or { claimSignatures: [{ signature, attestorAddress }] }
  const sigData = result.signatures;
  if (!sigData) {
    console.log('2. No signatures found in proof.');
    process.exit(1);
  }

  // Convert the claimSignature object ({0: 213, 1: 93, ...}) to a hex string
  function sigObjectToHex(obj: Record<string, number>): `0x${string}` {
    const keys = Object.keys(obj).map(Number).sort((a, b) => a - b);
    const bytes = new Uint8Array(keys.length);
    // eslint-disable-next-line functional/no-loop-statements
    for (const k of keys) {
      bytes[k] = obj[String(k)]!;
    }
    return `0x${Buffer.from(bytes).toString('hex')}` as `0x${string}`;
  }

  const attestorAddress = sigData.attestorAddress;
  const signatureHex = sigData.claimSignature
    ? sigObjectToHex(sigData.claimSignature)
    : undefined;

  if (!attestorAddress || !signatureHex) {
    console.log('2. Could not parse signature from proof.');
    console.log(`   Raw: ${JSON.stringify(sigData).slice(0, 300)}`);
    process.exit(1);
  }

  console.log('2. Verifying signature...');
  try {
    const recovered = await verifySignature(claim, signatureHex);
    const sigMatch = recovered.toLowerCase() === attestorAddress.toLowerCase();
    console.log(`   Recovered: ${recovered}`);
    console.log(`   Expected:  ${attestorAddress}`);
    console.log(`   Match:     ${sigMatch ? 'PASS' : 'FAIL'}`);
  } catch (error) {
    console.log(`   FAILED to recover: ${error}`);
  }
  console.log();

  // Step 3: Display extracted data
  console.log('3. Claim data:');
  console.log(`   Provider:   ${claim.provider}`);
  console.log(`   Timestamp:  ${claim.timestampS} (${new Date(claim.timestampS * 1000).toISOString()})`);
  console.log(`   Epoch:      ${claim.epoch}`);
  console.log(`   Owner:      ${claim.owner}`);

  try {
    const context = JSON.parse(claim.context);
    if (context.extractedParameters) {
      console.log('   Extracted:');
      for (const [key, value] of Object.entries(context.extractedParameters)) {
        console.log(`     ${key}: ${value}`);
      }
    }
  } catch {
    console.log(`   Context:    ${claim.context.slice(0, 200)}`);
  }

  console.log();
  console.log('--- Verification complete ---');
}

main();
