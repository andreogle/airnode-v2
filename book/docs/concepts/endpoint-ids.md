---
slug: /concepts/endpoint-ids
sidebar_position: 3
---

# Endpoint IDs

Endpoint IDs are deterministic hashes of the full API specification. They are not names, not UUIDs, not
auto-incrementing counters. The ID is derived from what the endpoint does -- its URL, path, method, parameters, and
encoding -- so the airnode's signature carries a commitment to exactly what was called and how the response was
interpreted.

## Derivation

The endpoint ID is the keccak256 hash of a pipe-delimited canonical string:

```
endpointId = keccak256(url | path | method | sorted parameters | encoding spec | encrypt spec)
```

(The `encoding spec` and `encrypt spec` segments are only present when the endpoint configures them.)

Concretely, for an endpoint configured as:

```yaml
apis:
  - name: CoinGecko
    url: https://api.coingecko.com/api/v3
    endpoints:
      - name: coinPrice
        path: /simple/price
        method: GET
        parameters:
          - name: vs_currencies
            in: query
            fixed: usd
          - name: ids
            in: query
            required: true
        encoding:
          type: int256
          path: $.ethereum.usd
          times: '1e18'
```

The canonical string is:

```
https://api.coingecko.com/api/v3|/simple/price|GET|ids,vs_currencies=usd|type=int256,path=$.ethereum.usd,times=1e18
```

And the endpoint ID is `keccak256` of that string encoded as hex bytes.

### Fixed vs. client-controlled encoding

One upstream API usually serves many different consumers. A CoinGecko price endpoint can be projected as `int256 × 1e18`
for a lending protocol, as `uint128 × 1e8` for a DEX, or read for its `last_updated_at` timestamp by a staleness check.
These are legitimate, simultaneous uses of the same HTTP call.

Airnode supports this by letting the operator decide **per field** whether to pin a concrete value or open it to the
client via the literal wildcard `'*'`. Wildcard fields are filled at request time via reserved parameters `_type`,
`_path`, and `_times` in the request body. The endpoint ID commits to the exact split — whatever the operator wrote
flows through to the canonical string verbatim, so a `'*'` in config means `*` in the ID.

`type` and `path` are required whenever an `encoding` block is present. `times` is optional and only valid for numeric
types (`int256` / `uint256`).

Three valid configurations:

| Operator config                                                                       | Encoding spec in ID                           | Who controls what                                     |
| ------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------- |
| `encoding: { type: int256, path: $.price, times: '1e18' }` — fully pinned             | `type=int256,path=$.price,times=1e18`         | Fully operator-fixed                                  |
| `encoding: { type: int256, path: '*', times: '1e18' }` — pin type & multiplier        | `type=int256,path=*,times=1e18`               | Operator fixes type & multiplier; client chooses path |
| `encoding: { type: '*', path: '*', times: '*' }` — all wildcards (fully open)         | `type=*,path=*,times=*`                       | Client fully controls encoding                        |
| No `encoding` block at all                                                            | (encoding spec omitted from canonical string) | Endpoint returns raw-JSON-hash responses only         |

Client-supplied fields are **silently ignored** for any field the operator pinned. If the operator sets
`type: int256`, the request's `_type` parameter has no effect on encoding (it's still consumed by the pipeline and never
sent to the upstream API). Wildcard fields require the matching reserved parameter: omitting `_path` on an endpoint
with `path: '*'` returns 400.

### FHE-encrypted endpoints

An endpoint with an [`encrypt`](/docs/concepts/fhe-encryption) block appends an encryption spec to the canonical string:

```
fhe=euint256,contract=0x5fbdb2315678afecb367f032d93f642f64180aa3
```

So the endpoint ID commits to the ciphertext type and the consumer contract the encrypted input is bound to. The
`encrypt.contract` value is always operator-fixed — there is no requester-controlled variant — and the relayer/verifier
settings (`settings.fhe`) are operational config, so they are _not_ part of the ID.

### Why this design

The two obvious alternatives both fail.

**"Force operators to fully fix every projection."** This sounds safer, but it turns the operator into a gatekeeper for
every consumer-side design change. Each new downstream use case (new type, new JSON path, new multiplier) would require
an operator config push, a new endpoint ID, and coordination across teams that have no business reason to coordinate. In
practice, operators would either (a) refuse to add endpoints, killing adoption, or (b) add every imaginable projection
upfront, which is neither maintainable nor knowable in advance.

**"Leave encoding fully unbound and stop including it in the ID."** This is what v1 effectively did. The endpoint ID
becomes a loose identifier of "which upstream was called," and the signature over `(endpointId, timestamp, data)`
carries no guarantee about what `data` means. On-chain consumers then need out-of-band schema agreements to interpret
the bytes safely — which reintroduces the registry and coordination problems that specification-bound IDs were
introduced to solve.

**The middle ground.** The endpoint ID commits to the _contract_ between operator and consumer: which fields the
operator stands behind, and which fields the submitter is trusted to choose. A consumer contract hard-coding a specific
endpoint ID implicitly accepts exactly that trust split:

- `keccak256(...|type=int256,path=$.price,times=1e18)` — the consumer is trusting only the operator. The submitter
  cannot influence what the bytes mean.
- `keccak256(...|type=int256,path=*,times=1e18)` — the consumer is trusting the operator for type & multiplier, and
  trusting the submitter to pick a meaningful JSON path. This is a weaker guarantee and should be used deliberately.
- `keccak256(...|type=*,path=*,times=*)` — the consumer is trusting the submitter for everything about the projection.
  Only reasonable in contexts where the submitter is the consumer itself (they sign the transaction that submits, so
  they're only lying to themselves).

If the operator later widens or narrows an endpoint (e.g. removes the fixed `type`), the endpoint ID changes and any
consumer hard-coding the old ID stops matching new signatures — exactly the behavior you want. The operator cannot
silently alter the trust split of an existing endpoint.

**Security properties this gives you:**

1. **Clients cannot widen an endpoint.** `_type`/`_path`/`_times` only fill fields the operator left open; they cannot
   override fixed values. A malicious submitter cannot turn a fully-fixed `type=int256,path=$.price` endpoint into
   something that projects volume or timestamp instead.
2. **Consumers explicitly opt into any flexibility.** By hard-coding a specific ID, a consumer is accepting the exact
   encoding contract baked into that ID. A consumer who wants no submitter-side flexibility simply refuses to recognize
   any ID whose encoding spec contains `*`.
3. **Operators cannot silently rewire an endpoint.** Any change to the fixed-vs-wildcard split changes the ID. Existing
   consumers hard-coding the old ID stop accepting signatures the moment the operator widens or narrows the endpoint.

### Endpoints with no `encoding` block

An endpoint with no `encoding` block in config does not include an encoding spec in the canonical string. Its signature
covers `keccak256(json_hash)` of the raw upstream response. Reserved request parameters cannot synthesize an encoding
out of nothing — `_type` / `_path` / `_times` are ignored in raw mode, so the only way to ABI-encode a response is for
the operator to declare an `encoding` block (pinned or wildcarded).

If a consumer contract wants the endpoint ID to bind some encoding shape, the operator should declare an `encoding`
block with the appropriate pin/wildcard split. An endpoint without any `encoding` block should be treated as
raw-JSON-only from a consumer perspective.

## What Is Included

These fields are part of the hash:

| Field                 | Example                            | Why                                                            |
| --------------------- | ---------------------------------- | -------------------------------------------------------------- |
| `api.url`             | `https://api.coingecko.com/api/v3` | Different APIs produce different endpoint IDs                  |
| `endpoint.path`       | `/simple/price`                    | Different paths on the same API are different endpoints        |
| `endpoint.method`     | `GET`                              | A GET and POST to the same path are different operations       |
| Non-secret parameters | `ids,vs_currencies=usd`            | Parameters define what data is being requested                 |
| `encoding.type`       | `int256` or `*`                    | Different encodings of the same data produce different outputs |
| `encoding.path`       | `$.ethereum.usd` or `*`            | Extracting different fields produces different data            |
| `encoding.times`      | `1e18` or `*`                      | Different multipliers produce different values                 |
| `encrypt.type`        | `euint256` (if `encrypt` is set)   | The FHE ciphertext type changes the response shape             |
| `encrypt.contract`    | `0x5fbdb2…` (if `encrypt` is set)  | The encrypted input is bound to this consumer contract         |

### Parameter rules

Parameters are sorted alphabetically by name and formatted as:

- **Client-provided** (no `fixed` value): just the name, e.g. `ids`
- **Fixed value**: name=value, e.g. `vs_currencies=usd`
- **Secret parameters** (`secret: true` or `fixed` value starting with `${`): excluded entirely

This means adding a secret API key header to the config does not change the endpoint ID. Two operators using the same
API -- one with a free key, one with a paid key -- get the same endpoint ID as long as the public specification matches.

## What Is Excluded

These fields do not affect the endpoint ID:

| Field                          | Why excluded                                                       |
| ------------------------------ | ------------------------------------------------------------------ |
| `endpoint.name`                | Names are for human readability, not identity                      |
| `api.headers`                  | Headers often contain secrets (API keys, auth tokens)              |
| `api.auth`                     | Client-facing auth is an operator choice, not a data specification |
| `api.timeout`                  | Operational config, not data specification                         |
| `api.cache` / `endpoint.cache` | Caching is an optimization, not a data property                    |
| `endpoint.mode`                | `sync` / `async` / `stream` is a delivery choice, not a data spec  |
| `endpoint.auth`                | Endpoint-level client auth override, like `api.auth`               |
| Secret parameters              | Parameters marked `secret: true` or with `${ENV_VAR}` fixed values |
| Default values                 | Defaults are convenience for clients, not part of the spec         |

## Why This Design

### Commitment to the API specification

Airnode is built for the first-party oracle model: the API provider runs the airnode that serves their own API. The
endpoint ID turns that arrangement into a cryptographic commitment. A consumer contract hard-coding an endpoint ID binds
itself to the specific URL, path, method, parameters, and encoding rules the provider declared in config.

If the provider later changes any part of the spec — redirects to a different upstream, renames a parameter, tweaks the
encoding — the endpoint ID changes and existing signatures no longer match what the consumer expected. The consumer
immediately stops accepting data under the old ID. There is no silent re-pointing.

The same property holds in reverse: if you recompute the endpoint ID from a published config and it matches the ID you
had already integrated against, you know the airnode is serving exactly the spec you committed to.

### Aggregation across providers

Different API providers each run their own airnode for their own API. A consumer can aggregate signed data from several
first-party airnodes — for instance, combining BTC/USD prices from multiple exchanges — by collecting signatures across
those distinct endpoint IDs. Each airnode's signature is independently verifiable, and the aggregation happens at the
consumer's side with no coordination layer or shared registry.

### TLS proof verification

The canonical string used to derive the endpoint ID matches the information that would be present in a TLS proof of the
HTTP request. A future verifier can check that:

1. The API URL and path in the TLS proof match the endpoint specification.
2. The query parameters in the TLS proof match the non-secret parameters.
3. The endpoint ID hash is consistent with the observed request.

This is why secret parameters are excluded -- they would appear in the TLS transcript but should not be part of the
public identity.

### No registry

Endpoint IDs do not require registration, coordination, or a central authority. An operator derives the ID locally from
the config, publishes it alongside their endpoint, and consumers integrate against it directly.

## Computing an Endpoint ID

The CLI prints endpoint IDs for every endpoint when you validate a config:

```bash
airnode config validate -c config.yaml
```

You can also derive the ID programmatically:

```typescript
import { keccak256, toHex } from 'viem';

const canonical = [
  'https://api.coingecko.com/api/v3',
  '/simple/price',
  'GET',
  'ids,vs_currencies=usd',
  'type=int256,path=$.ethereum.usd,times=1e18',
].join('|');

const endpointId = keccak256(toHex(canonical));
```
