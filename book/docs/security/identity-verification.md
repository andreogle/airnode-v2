---
slug: /security/identity-verification
sidebar_position: 2
---

# Identity Verification (ERC-7529)

Identity verification checks that a domain's DNS records associate it with an Airnode address. It follows
[ERC-7529](https://eips.ethereum.org/EIPS/eip-7529), a standard for associating EVM addresses with DNS domains.

## How it works

The operator sets a DNS TXT record at a well-known host that contains their airnode address. Anyone can verify the
association by querying DNS and comparing the record value against the on-chain address.

```
Host:  ERC-7529.<chainId>._domaincontracts.<domain>
Value: <comma-separated checksummed airnode addresses>
```

For example, if CoinGecko operates an airnode at `0xAbC123...` on Ethereum mainnet (chain 1):

```
Host:  ERC-7529.1._domaincontracts.api.coingecko.com
Value: 0xAbC123...
```

An operator running multiple airnodes can list all addresses in a single record, comma-separated:

```
Value: 0xAbC123..., 0xDef456...
```

## For operators

### 1. Get the TXT record details

```bash
airnode identity show --domain api.coingecko.com
```

This reads `AIRNODE_MNEMONIC` or `AIRNODE_PRIVATE_KEY`, derives the address, and displays the TXT record to set:

```
──────────────────────────────────────────────────────────────────────
  Airnode Identity
──────────────────────────────────────────────────────────────────────

  Address    0xAbC123...
  Domain     api.coingecko.com

  Set this DNS TXT record:

  Host     ERC-7529.1._domaincontracts.api.coingecko.com
  Value    0xAbC123...

──────────────────────────────────────────────────────────────────────
```

Use `--chain-id` if your airnode serves chains other than mainnet:

```bash
airnode identity show --domain api.coingecko.com --chain-id 137
```

### 2. Set the DNS record

Add a TXT record in your DNS provider's dashboard. The host and value are shown by the `show` command. DNS propagation
typically takes a few minutes.

### 3. Verify it works

```bash
airnode identity verify --address 0xAbC123... --domain api.coingecko.com
```

## For requesters

Verify an airnode's identity before integrating:

```bash
# Single address
airnode identity verify --address 0xAbC123... --domain api.coingecko.com

# Multiple addresses at once
airnode identity verify -a 0xAbC123... -a 0xDef456... -d api.coingecko.com

# Comma-separated
airnode identity verify -a 0xAbC123...,0xDef456... -d api.coingecko.com
```

The command queries DNS over HTTPS (Google DoH) and checks if each address appears in the TXT record. It exits with code
0 when all addresses are verified, 1 if any are missing.

### Manual verification

You can verify without the CLI by querying DNS directly:

```bash
# Using dig
dig TXT ERC-7529.1._domaincontracts.api.coingecko.com

# Using DNS-over-HTTPS
curl -s "https://dns.google/resolve?name=ERC-7529.1._domaincontracts.api.coingecko.com&type=TXT"
```

Check that the response contains the expected airnode address.

## Trust model

Identity verification shows that the domain controller published an association with an Airnode address. It does not
prove who runs the process or whether its responses are correct. The record claims: "this domain recognizes this
address." This is useful because:

- **Requesters can verify the published domain association** before trusting an Airnode.
- **DNS records are controlled by domain owners**, not by the airnode software. Only someone with access to
  `api.coingecko.com`'s DNS can set records under that domain.
- **It composes with existing trust**: if you already trust CoinGecko's API, verifying that their airnode address
  resolves to their domain extends that trust to their on-chain oracle.

### First-party verification

DNS identity verification is most meaningful for **first-party airnodes** — where the API provider operates the node.
When an API provider sets a DNS TXT record for an Airnode address under its API domain, consumers can attribute that
address to the domain controller. This avoids adding an unidentified relay, but does not prove response provenance.

A third-party operator can only verify their own domain. If `oracle-service.example.com` claims to serve CoinGecko data,
DNS verification proves the operator controls `oracle-service.example.com` — not that CoinGecko authorized them or that
the data is genuine. Consumers should always look for DNS verification against the **API provider's domain**, not the
operator's domain.

What identity verification does **not** prove:

- That the airnode is serving correct data (with first-party operation, the provider's reputation is at stake; with
  third-party operation, this is unverifiable).
- That the configuration hasn't changed (the operator can update their config at any time).
- That the DNS record is current (records can be removed, so verify close to integration time).

## Programmatic usage

The identity verification functions are exported for use in your own code:

```ts
import { verifyIdentity, buildTxtRecordHost } from 'airnode/identity';

// Verify one or more addresses against a domain
const results = await verifyIdentity(['0xAbC123...', '0xDef456...'], 'api.coingecko.com');

for (const { address, verified } of results) {
  console.log(`${address}: ${verified ? 'verified' : 'not found'}`);
}

// Build the TXT record host for a custom chain
const host = buildTxtRecordHost('api.coingecko.com', 137);
// --> "ERC-7529.137._domaincontracts.api.coingecko.com"
```

Exported from `src/identity.ts`:

| Function                 | Description                                                      |
| ------------------------ | ---------------------------------------------------------------- |
| `verifyIdentity()`       | Verify one or more addresses against a domain's TXT records      |
| `buildTxtRecordHost()`   | Build the ERC-7529 TXT record hostname for a domain and chain ID |
| `queryTxtRecords()`      | Query DNS-over-HTTPS for TXT records at a given hostname         |
| `findAddressInRecords()` | Check if an address appears in a set of TXT record values        |

## ERC-7529

The TXT record format follows [ERC-7529](https://eips.ethereum.org/EIPS/eip-7529). The standard supports comma-separated
addresses in a single record.
