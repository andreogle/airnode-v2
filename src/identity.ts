// =============================================================================
// ERC-7529 DNS identity verification
// =============================================================================

// =============================================================================
// TXT record host
// =============================================================================
function buildTxtRecordHost(domain: string, chainId: number): string {
  return `ERC-7529.${String(chainId)}._domaincontracts.${domain}`;
}

// =============================================================================
// DNS-over-HTTPS query
// =============================================================================
interface DohAnswer {
  readonly type: number;
  readonly data: string;
}

interface DohResponse {
  readonly Status: number;
  readonly Answer?: readonly DohAnswer[];
}

async function queryTxtRecords(host: string): Promise<readonly string[]> {
  const url = `https://dns.google/resolve?name=${encodeURIComponent(host)}&type=TXT`;
  const response = await fetch(url);
  const data = (await response.json()) as DohResponse;

  if (data.Status !== 0 || !data.Answer) return [];

  // TXT records (type 16) — strip surrounding quotes added by DNS
  return data.Answer.filter((a) => a.type === 16).map((a) => a.data.replaceAll(/^"|"$/g, ''));
}

// =============================================================================
// Address matching
// =============================================================================
function findAddressInRecords(records: readonly string[], address: string): boolean {
  const normalized = address.toLowerCase();

  return records.some((record) => record.split(',').some((entry) => entry.trim().toLowerCase() === normalized));
}

// =============================================================================
// High-level verification
// =============================================================================
interface VerifyResult {
  readonly address: string;
  readonly verified: boolean;
}

async function verifyIdentity(
  addresses: readonly string[],
  domain: string,
  chainId = 1
): Promise<readonly VerifyResult[]> {
  const host = buildTxtRecordHost(domain, chainId);
  const records = await queryTxtRecords(host);

  return addresses.map((address) => ({
    address,
    verified: findAddressInRecords(records, address),
  }));
}

export { buildTxtRecordHost, findAddressInRecords, queryTxtRecords, verifyIdentity };
export type { VerifyResult };
