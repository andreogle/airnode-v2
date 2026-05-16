---
slug: /operators/publishing-endpoints
sidebar_position: 3
---

# Publishing Endpoints

Once your airnode is running, consumers need three things to use it:

1. The airnode's **base URL** (where to send `POST /endpoints/{endpointId}`).
2. The **endpoint ID** for each endpoint they want to call.
3. The **airnode address**, so they can verify signatures recover correctly.

This page is the operator-side checklist for handing those out.

## What an airnode address looks like

The address is derived from your `AIRNODE_PRIVATE_KEY` (or `AIRNODE_MNEMONIC`). You can read it back at any time:

```bash
airnode address
```

```
0xd1e98F3Ac20DA5e4da874723517c914a31b0e857
```

You can also fetch it from a running server:

```bash
curl http://localhost:3000/health
```

```json
{
  "status": "ok",
  "airnode": "0xd1e98F3Ac20DA5e4da874723517c914a31b0e857"
}
```

This address is what consumers pin as a trusted signer. Never let it drift — rotating the key means re-deriving every
endpoint a consumer trusts.

## Listing endpoint IDs

On startup, the airnode logs every registered endpoint with its derived ID:

```
Plugin loaded: heartbeat (budget: 5000ms)
Loaded 3 endpoint(s):
  - CoinGecko/coinPrice    0x1c3e0fa5ac82e5514e0e9abac98e0b8e6c58b7bea12ae0393e4e4abe64ab9620
  - CoinGecko/coinPriceRaw 0x9e1354c4ede00d01d99b610bfe6873ede803e0d598aeff820b51cc9d81a3568d
  - WeatherAPI/currentTemp 0xa1b2...
```

The endpoint ID is a deterministic hash of the endpoint specification — change the path, method, parameters, or encoding
and the ID changes too. See [Endpoint IDs](/docs/concepts/endpoint-ids) for what the hash commits to and why that
matters for consumers.

## Proving you're the API provider (optional)

For a consumer to know that `airnode.example.com` is actually run by the operator of `api.example.com`, publish a
[DNS identity record](/docs/security/identity-verification) (`_airnode.api.example.com` TXT). Consumers can verify the
DNS record matches the address `/health` returned before pinning the address as trusted.

## What to share with consumers

A complete handoff covers, per endpoint:

| Field                 | Example                                                              | Why the consumer needs it                                    |
| --------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------ |
| Endpoint URL          | `https://airnode.example.com/endpoints/{endpointId}`                 | Where to POST.                                               |
| Endpoint ID           | `0x1c3e0fa5ac82e5514e0e9abac98e0b8e6c58b7bea12ae0393e4e4abe64ab9620` | Pinned in their off-chain client or consumer contract.       |
| Airnode address       | `0xd1e98F3Ac20DA5e4da874723517c914a31b0e857`                         | Recovers from the signature.                                 |
| Parameter contract    | List of required + optional request parameters                       | So they can build a valid request body.                      |
| Encoding shape        | e.g. `int256 × 1e18` for `$.ethereum.usd`                            | So they can `abi.decode` the result.                         |
| Wildcard fields       | Which encoding fields are `'*'`, if any                              | They must supply matching `_type`/`_path`/`_times` per call. |
| Auth                  | `free`, `apiKey` (and key value out-of-band), or `x402` payment      | So they can authenticate the request.                        |
| Freshness expectation | e.g. "data is refreshed every 30s; reject >120s old"                 | Sets their on-chain or off-chain staleness threshold.        |
| Cache TTL             | If `apis[].cache.maxAge` is set, what window                         | They should expect identical responses inside the window.    |

The endpoint ID changes if you change the spec. Tell consumers up front whether the endpoint is considered stable — if
you reserve the right to change `encoding.times` from `1e18` to `1e6`, say so. Any change invalidates the old ID and
breaks consumers that hard-coded it.

## Operator-side checklist

Before announcing an endpoint:

- [ ] The endpoint loads (`airnode start` prints its ID without errors).
- [ ] The upstream API call works end-to-end (`curl` the airnode and inspect the signed response).
- [ ] The signature recovers to the address you intend to publish.
- [ ] If `auth` is `apiKey`, the key delivery channel is in place.
- [ ] If `auth` is `x402`, the payment recipient address and chain are correct.
- [ ] If consumers will read on-chain, a deployed `AirnodeVerifier` exists on their target chain (the same one across
      chains is fine — there's no per-airnode registration).
- [ ] If you're claiming ownership of the upstream API's domain, the
      [DNS identity record](/docs/security/identity-verification) is published.
