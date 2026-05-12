---
slug: /concepts/proofs
sidebar_position: 5
---

# TLS Proofs

TLS proofs provide cryptographic evidence that an API response came from a specific HTTPS endpoint. When enabled,
Airnode attaches a proof to each response alongside the EIP-191 signature. The signature proves the airnode endorsed the
data; the proof proves the data actually came from the upstream API over TLS.

## Why TLS proofs

Without a proof, you trust the airnode operator to faithfully relay the API response. The EIP-191 signature proves who
signed the data, but not where the data came from. A malicious operator could fabricate responses.

TLS proofs close this gap. An independent attestor participates in the TLS session (via MPC-TLS) and produces a
cryptographic attestation that the response came from the claimed HTTPS endpoint. The attestor never sees the full
plaintext -- it only verifies the TLS transcript and checks that the response matches specified patterns.

## How it works

1. Airnode calls the upstream API and receives the JSON response (the normal pipeline).
2. Airnode sends a proof request to the proof gateway with the full URL, HTTP method, headers, and `responseMatches`
   patterns.
3. The proof gateway coordinates with an attestor to re-fetch the URL via MPC-TLS.
4. The attestor verifies the TLS session and checks that the response matches the `responseMatches` regex patterns.
5. The attestor signs a claim attesting to the match, and the proof is returned to Airnode.
6. Airnode attaches the proof to the response.

## Configuration

Enable proofs globally in `settings` and configure `responseMatches` on each endpoint that should have proofs:

```yaml
settings:
  proof:
    type: reclaim
    gatewayUrl: http://localhost:5177/v1/prove

apis:
  - name: CoinGecko
    url: https://api.coingecko.com/api/v3
    endpoints:
      - name: coinPrice
        path: /simple/price
        parameters:
          - name: ids
            in: query
            required: true
          - name: vs_currencies
            in: query
            default: usd
        encoding:
          type: int256
          path: $.ethereum.usd
          times: '1e18'
        responseMatches:
          - type: regex
            value: '"usd":\s*(?<price>[\d.]+)'
```

The `gatewayUrl` must be the **full URL** to the proof endpoint. Airnode sends the request directly to this URL without
appending any path.

## `responseMatches`

Each entry defines a regex pattern the attestor checks against the API response. The attestor only signs a claim if all
patterns match. This ensures the proof covers specific data in the response, not just that some response was received.

```yaml
responseMatches:
  - type: regex
    value: '"usd":\s*(?<price>[\d.]+)'
```

| Field   | Type     | Required | Description                             |
| ------- | -------- | -------- | --------------------------------------- |
| `type`  | `string` | Yes      | Must be `'regex'`.                      |
| `value` | `string` | Yes      | Regex pattern to match in the response. |

Endpoints without `responseMatches` skip proof generation entirely, even when proof is enabled globally.

## Response format

When a proof is successfully generated, the response includes a `proof` field:

```json
{
  "airnode": "0x...",
  "endpointId": "0x...",
  "timestamp": 1711234567,
  "data": "0x...",
  "signature": "0x...",
  "proof": {
    "claim": {
      "provider": "http",
      "parameters": "{...}",
      "context": "{...}",
      "owner": "0x...",
      "timestampS": 1711234567,
      "epoch": 1,
      "identifier": "0x..."
    },
    "signatures": {
      "attestorAddress": "0x7ff8f768be3c32132d395e888e44a6299e532604",
      "claimSignature": "0x..."
    }
  }
}
```

The `proof.signatures.attestorAddress` identifies the attestor that generated the proof. The `claimSignature` is a
signature over the claim data that can be verified independently.

## What the proof attests (and what it doesn't)

The proof covers the _request_ exactly: Airnode hands the gateway the same URL, method, headers, and body it actually
sent, and rejects any returned proof whose `claim.parameters` disagree (treated as a non-fatal failure — see below).

It does **not** guarantee that the proof's _response_ equals the data Airnode signed. The attestor performs its own TLS
session to the upstream, separate from Airnode's. For volatile data (a price that ticks between the two fetches) the
attested response can legitimately differ from the signed payload. A future on-chain verifier that wants to bind the
proof to the signed data must account for this — e.g. by comparing only the `responseMatches`-extracted fields and
allowing a tolerance, not by requiring byte-for-byte equality.

## Non-fatal behavior

Proof generation is **non-fatal**. If the proof gateway is unavailable, times out, returns an error, or returns a proof
that doesn't match the request Airnode made:

- The response is still returned without the `proof` field.
- A `WARN` log is emitted with the failure reason.
- The EIP-191 signature is unaffected.

The gateway timeout is configurable via [`settings.proof.timeout`](/docs/config/settings#proof) (default 30s). Because
the proof is fetched after signing on the sync path, that timeout is added to the response latency on a slow gateway.

This ensures that proof infrastructure issues do not block data delivery. Consumers that require proofs should check for
the presence of the `proof` field and reject responses without it.

## URL construction

Airnode builds the full URL for the proof request by resolving all endpoint parameters (path, query, defaults, fixed
values) against the API base URL. This ensures the attestor fetches the exact same URL that Airnode called. For example,
an endpoint at `/simple/price` with query parameters `ids=ethereum&vs_currencies=usd` produces:

```
https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd
```

## Example config

See [`examples/configs/reclaim-proof/`](https://github.com/api3dao/airnode-v2/tree/main/examples/configs/reclaim-proof)
for a minimal working configuration with TLS proofs enabled.
