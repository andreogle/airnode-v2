# Signed API Airnode

Airnode is an HTTP server that signs API responses. Clients receive signed data and optionally submit it on-chain. The
airnode never touches the chain.

## Table of contents

1. [Core model](#core-model)
2. [Endpoint ID as verifiable commitment](#endpoint-id-as-verifiable-commitment)
   - [The problem with name-based IDs](#the-problem-with-name-based-ids)
   - [Specification-bound endpoint IDs](#specification-bound-endpoint-ids)
   - [What's included in the hash](#whats-included-in-the-hash)
   - [What's excluded from the hash](#whats-excluded-from-the-hash)
   - [What the endpoint ID is and isn't](#what-the-endpoint-id-is-and-isnt)
   - [How TLS proofs will anchor the endpoint ID (future)](#how-tls-proofs-will-anchor-the-endpoint-id-future)
   - [Cross-airnode comparability](#cross-airnode-comparability)
   - [Self-describing endpoints](#self-describing-endpoints)
   - [Handling URL changes](#handling-url-changes)
   - [Why not publish the full config?](#why-not-publish-the-full-config)
   - [Derivation function](#derivation-function)
3. [HTTP interface](#http-interface)
   - [Endpoints](#endpoints)
   - [Response format](#response-format)
   - [Synchronous requests](#synchronous-requests)
   - [Asynchronous requests](#asynchronous-requests)
   - [Streaming](#streaming)
4. [Authentication and payment](#authentication-and-payment)
   - [x402 (HTTP-native payment)](#x402-http-native-payment)
   - [NFT keys](#nft-keys)
   - [API key](#api-key)
   - [No auth](#no-auth)
5. [On-chain verification](#on-chain-verification)
   - [Verifier contract](#verifier-contract)
   - [Timestamp verification](#timestamp-verification)
   - [Quorum verification](#quorum-verification)
   - [No on-chain registry](#no-on-chain-registry)
6. [Relayer](#relayer)
   - [Properties](#properties)
7. [Processing pipeline](#processing-pipeline)
   - [Request handling](#request-handling)
   - [Worker pool](#worker-pool)
   - [Plugin hooks](#plugin-hooks)
   - [Code mode plugins](#code-mode-plugins)
8. [Caching, push, and data feeds](#caching-push-and-data-feeds)
   - [Pull with cache](#pull-with-cache)
   - [Push to cache server](#push-to-cache-server)
   - [Push configuration](#push-configuration)
   - [Delayed endpoints](#delayed-endpoints)
   - [Data feeds as a special case](#data-feeds-as-a-special-case)
   - [Beacon ID](#beacon-id)
9. [Configuration](#configuration)
   - [Structure](#structure) (inheritance model, headers vs auth)
   - [Full example](#full-example) (CoinGecko, OpenAI, WeatherAPI)
   - [Key design decisions](#key-design-decisions)
10. [Proof architecture](#proof-architecture)
    - [Trust assumptions](#trust-assumptions)
    - [Verification levels](#verification-levels)
    - [Deterministic replay (available now)](#deterministic-replay-available-now)
    - [TLS proofs (TLSNotary / DECO) — future](#tls-proofs-tlsnotary--deco--future)
    - [TEE attestation (Intel TDX / AWS Nitro / AMD SEV-SNP)](#tee-attestation-intel-tdx--aws-nitro--amd-sev-snp)
    - [Endpoint verification without a registry](#endpoint-verification-without-a-registry)
    - [Proof modes](#proof-modes)
11. [Advanced patterns](#advanced-patterns)
    - [Multi-airnode aggregation](#multi-airnode-aggregation)
    - [Airnode-to-airnode composition](#airnode-to-airnode-composition)
    - [Signed responses as bearer credentials](#signed-responses-as-bearer-credentials)
    - [Conditional responses](#conditional-responses)
    - [Webhook push](#webhook-push)
    - [Endpoint marketplace](#endpoint-marketplace)
    - [ChainAPI as marketplace and operator platform](#chainapi-as-marketplace-and-operator-platform)
    - [Optimistic fulfillment with fraud proofs](#optimistic-fulfillment-with-fraud-proofs)
    - [AI agents as consumers](#ai-agents-as-consumers)
12. [Build sequence](#build-sequence)
13. [Future research](#future-research)
    - [Signing layer for existing APIs](#signing-layer-for-existing-apis)
    - [Response derivatives](#response-derivatives)
    - [Threshold signing](#threshold-signing)
    - [Signed errors, proof of absence, and SLA proofs](#signed-errors-proof-of-absence-and-sla-proofs)
    - [Response change detection](#response-change-detection)
    - [Request batching](#request-batching)
    - [Versioned response chain](#versioned-response-chain)
    - [Delegated sub-keys](#delegated-sub-keys)
    - [MCP server mode](#mcp-server-mode)
    - [Multi-value encoding](#multi-value-encoding)
    - [GraphQL support](#graphql-support)

## Core model

```
client → HTTP request (+ payment) → airnode → upstream API → sign response → HTTP response
```

The airnode is middleware between a client and an upstream API. It adds a cryptographic signature to the API response,
turning untrusted data into a verifiable attestation: "this airnode, at this time, received this data from this API."

The signed response is a portable artifact. The client can:

- Submit it on-chain via a verifier contract
- Present it to another service as proof
- Store it for later use
- Discard it and just use the data

On-chain delivery is one option, not the default path.

## Endpoint ID as verifiable commitment

### The problem with name-based IDs

If the endpoint ID is derived from names only:

```
endpointId = keccak256("CoinGecko" + "/" + "price")
```

This tells you nothing about what API is actually called. An operator could publish a config claiming endpoint `0xabc`
maps to CoinGecko, then run a different config that maps it to their own server. Even with TLS proofs, there's a gap:
the proof shows the response came from `some-server.com`, but nothing proves the endpoint ID was supposed to map to
`some-server.com`.

### Specification-bound endpoint IDs

The endpoint ID commits to the actual API specification — what server is called, what path, what HTTP method, what
parameters are expected, and how the response is processed:

```
endpointId = keccak256(
  baseUrl       || path         || method ||
  parameterSpec || encodingSpec || fixedParams
)
```

Concretely, for a CoinGecko price endpoint:

```
endpointId = keccak256(encodePacked(
  "https://api.coingecko.com/api/v3",  // baseUrl
  "/simple/price",                      // path
  "GET",                                // method
  // parameter spec: names, locations, required flags (sorted deterministically)
  "ids:query:true,vs_currencies:query:false",
  // encoding spec: type, JSONPath, multiplier
  "int256:$.bitcoin.usd:1000000",
  // fixed parameter values (non-secret only)
  "vs_currencies=usd",
))
```

### What's included in the hash

| Field           | Example                            | Why included                         |
| --------------- | ---------------------------------- | ------------------------------------ |
| `baseUrl`       | `https://api.coingecko.com/api/v3` | Commits to which API server          |
| `path`          | `/simple/price`                    | Commits to which endpoint            |
| `method`        | `GET`                              | Same path can have different methods |
| `parameterSpec` | `ids:query:true,...`               | Defines the request shape            |
| `encoding`      | `int256:$.bitcoin.usd:1000000`     | Defines extraction and encoding      |
| `fixedParams`   | `vs_currencies=usd`                | Constants baked into the endpoint    |

### What's excluded from the hash

| Field              | Why excluded                                                           |
| ------------------ | ---------------------------------------------------------------------- |
| Secret values      | `${...}` env vars and `secret: true` params — replaced with `<secret>` |
| Auth configuration | API key header names, bearer tokens — sensitive                        |
| Default values     | Fallbacks, not commitments — requester can override                    |
| Request values     | Vary per request — covered by request ID instead                       |
| Timeout / cache    | Operational settings, not semantic                                     |

A parameter is treated as secret if it references an environment variable (`${API_KEY}`) or has `secret: true` set
explicitly. Secret values are replaced with the literal sentinel `<secret>` before hashing. This means two operators
using different API keys for the same endpoint produce the same endpoint ID — which is correct, because they're serving
the same data from the same API.

The `secret` flag exists for hardcoded values that are still sensitive — a partner ID, an internal account number, or a
test key baked into the config. These need to be excluded from the endpoint ID hash and redacted from TLS proofs and
replay data, but they aren't environment variables.

### What the endpoint ID is and isn't

The endpoint ID is a commitment — a hash that encodes what the operator claims to do. On its own, it proves nothing.
It's a `keccak256` hash, so you can't extract the baseUrl back out of it. A malicious operator can compute the endpoint
ID for CoinGecko's spec, register it in a directory, and actually call a completely different server.

**Today**, without TLS proofs, the endpoint ID is a label that enables:

- **Discovery** — find airnodes that claim to serve the same data
- **Quorum grouping** — multiple independent operators under the same endpoint ID. If 5 operators sign data for the same
  endpoint ID and 3 agree on the value, it's likely correct. Fabrication requires collusion across independent parties.
- **Accountability** — the operator committed to a spec. Anyone can independently call the API and compare results.

**In the future**, when TLS proofs mature, the endpoint ID becomes a verified commitment — the TLS proof anchors it to
the actual HTTP request. See [How TLS proofs anchor the endpoint ID](#how-tls-proofs-anchor-the-endpoint-id) for
details.

| Proof mode  | What the endpoint ID does                                               |
| ----------- | ----------------------------------------------------------------------- |
| `none`      | A label. Enables discovery and quorum grouping.                         |
| `replay`    | A label. Replay proves processing but the response could be fabricated. |
| `tee`       | Verified commitment. TEE attestation enforces the config.               |
| `tlsnotary` | Verified commitment. TLS proof anchors it to the real request. (Future) |

### How TLS proofs will anchor the endpoint ID (future)

TLSNotary is not yet stable enough for production use (TLS 1.2 only, 2-5x latency, limited library maturity). This
section describes the verification model for when it is ready. In the meantime, the practical trust model is: operator
trust for single airnodes, quorum across multiple independent operators for high-value data.

When TLS proofs mature, they will prove the full HTTP transcript — both the request sent and the response received. The
prover (the airnode) selectively discloses parts of the transcript. Auth headers are redacted; everything else is
revealed.

The proof must reveal the full HTTP request, not just the server domain. Without the request line, an operator could
call the right server but the wrong path or with wrong parameters.

**What the TLS proof reveals:**

```
REVEALED:
  GET /api/v3/simple/price?ids=bitcoin&vs_currencies=usd HTTP/1.1
  Host: api.coingecko.com

  {"bitcoin":{"usd":67432.12}}

REDACTED:
  X-Api-Key: ██████████
```

**What the verifier checks against the endpoint specification:**

1. **Server** — TLS certificate proves domain is `api.coingecko.com` → matches `spec.baseUrl`
2. **Path** — revealed request line shows `/api/v3/simple/price` → matches `spec.baseUrl` path + `spec.path`
3. **Fixed params** — query string includes `vs_currencies=usd` → matches `spec.fixedParams`
4. **Client params** — query string includes `ids=bitcoin` → matches what the client requested
5. **Response** — the JSON body is proven to be the actual response to this specific request
6. **Extraction** — deterministic replay of `_path: $.bitcoin.usd` on the proven response produces the signed `data`
7. **Endpoint ID** — re-derive the endpoint ID from the spec, confirm it matches the signed `endpointId`. This proves
   the spec wasn't tampered with.

The endpoint ID is the join between the spec and the proof. The spec is the preimage (baseUrl, path, method, params,
extraction rules). The endpoint ID is the hash. The TLS proof proves the actual HTTP request matches the spec. The
verifier re-derives the hash to confirm the spec matches the endpoint ID.

If the proof only revealed the server domain but not the request path and parameters, the verification would be
incomplete — an operator could call the right server with wrong parameters. A TLS proof that redacts the request line
should be rejected.

#### Cross-airnode comparability

Two independent airnodes serving the same CoinGecko price endpoint with the same extraction rules produce the same
endpoint ID — even if they use different API keys, different server configs, or run on different infrastructure. The
endpoint ID is a content-addressed identifier for "this specific data feed from this specific API."

This means:

- A quorum verifier can check that all airnodes signed data for the same endpoint ID without trusting their names or
  metadata
- A client can discover multiple airnodes serving the same endpoint by looking for a known endpoint ID in a directory
- Endpoint IDs are portable across operators — the ID is a property of the data source, not the operator

#### Self-describing endpoints

Given an endpoint ID and the endpoint specification (published by the operator in documentation, a directory, or any
public channel), anyone can reconstruct exactly what API call the airnode makes and verify it by re-deriving the
endpoint ID. No need to trust the operator's description — the endpoint ID is the proof.

### Handling URL changes

API URLs change — versions bump (`/v3/` → `/v4/`), domains migrate, regional endpoints rotate. When the URL changes, the
endpoint ID changes. This is correct behavior: a different URL is a different data source, and the endpoint ID should
reflect that.

For planned migrations, the operator:

1. Adds the new endpoint (new URL → new endpoint ID) to their config
2. Publishes the new endpoint specification
3. Clients migrate to the new endpoint ID
4. Old endpoint is deprecated and eventually removed

For URL patterns (regional endpoints, load balancers), the base URL should be the canonical/stable URL, not a
region-specific one. If the operator uses `https://api.coingecko.com` rather than `https://us-east.api.coingecko.com`,
the endpoint ID remains stable across region switches.

### Why not publish the full config?

The endpoint ID commits to everything the requester cares about: the API server, the path, the method, the parameters,
and the extraction rules. That's the contract between the airnode and the requester. Everything else — server port, rate
limits, cache settings, plugin paths, auth infrastructure — is the operator's business.

Publishing the full config creates more problems than it solves:

- Exposes operational details (infrastructure, plugin paths, internal settings) for no verification benefit
- Operational config changes (timeouts, rate limits, cache) would appear as trust-breaking events when they're not
- Operators won't want to publish their infrastructure details
- Creates a maintenance burden to keep published config in sync

The endpoint ID is the only commitment that matters to the requester. It's structurally verifiable (a TLS proof can be
checked against the baseUrl it commits to) and self-contained (the extraction rules are embedded in it).

A full config hash is only useful in **TEE mode**, where the hardware attestation enforces that the code loaded a
specific config. In that context the hash is in the TEE attestation, not published externally. Outside of TEE, the
endpoint ID is sufficient.

### Derivation function

```typescript
const isSecret = (param: Parameter): boolean =>
  param.secret === true || (typeof param.fixed === 'string' && param.fixed.startsWith('${'));

const deriveEndpointId = (api: ApiSpec, endpoint: EndpointSpec): Hex => {
  // Sort parameters deterministically by name
  const paramSpec = [...endpoint.parameters]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => `${p.name}:${p.in}:${String(p.required ?? false)}`)
    .join(',');

  // Encoding spec (empty string if raw mode — no encoding block)
  const encodingSpec = endpoint.encoding
    ? `${endpoint.encoding.type}:${endpoint.encoding.path}:${String(endpoint.encoding.times ?? 1)}`
    : '';

  // Fixed parameter values (non-secret), sorted by name
  const fixedSpec = [...endpoint.parameters]
    .filter((p) => p.fixed !== undefined && !isSecret(p))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => `${p.name}=${String(p.fixed)}`)
    .join(',');

  return keccak256(
    encodePacked(
      ['string', 'string', 'string', 'string', 'string', 'string'],
      [api.url, endpoint.path, endpoint.method ?? 'GET', paramSpec, encodingSpec, fixedSpec]
    )
  );
};
```

## HTTP interface

### Endpoints

Every endpoint the airnode serves is an HTTP route. The route is the endpoint ID — a specification-bound hash that
commits to the API URL, path, method, parameters, and extraction rules.

```
POST /endpoints/{endpointId}
```

The request body contains parameters:

```json
{
  "parameters": {
    "coinId": "bitcoin",
    "currency": "usd"
  }
}
```

### Response format

Every response includes the signed data:

```json
{
  "requestId": "0x...",
  "airnode": "0x...",
  "endpointId": "0x...",
  "timestamp": 1234567890,
  "data": "0x...",
  "signature": "0x..."
}
```

- `requestId` — deterministic hash of `(airnode, endpointId, parameters, timestamp)`, unique per request
- `endpointId` — specification-bound hash committing to the API URL, extraction rules, and fixed parameters
- `data` — ABI-encoded response using the endpoint's reserved parameters (`_type`, `_path`, `_times`)
- `signature` — EIP-191 signature over `keccak256(requestId || keccak256(data))`, recoverable to the airnode address

The client can verify the signature locally without any on-chain call. The same signature is what the on-chain verifier
contract checks. The `endpointId` can be verified against the published API specification — anyone with the spec can
reconstruct it.

### Synchronous requests

For fast APIs (price feeds, weather, public data), the response is immediate:

```
POST /endpoints/{endpointId} → 200 OK with signed data
```

The airnode calls the upstream API, processes the response, signs it, and returns it in the same HTTP request. Typical
latency: upstream API latency + ~5ms for processing and signing.

### Asynchronous requests

For slow APIs (AI inference, human review, complex computation), the request returns immediately with a reference:

```
POST /endpoints/{endpointId}
→ 202 Accepted
{
  "requestId": "0x...",
  "status": "pending",
  "pollUrl": "/requests/{requestId}",
  "estimatedMs": 30000
}

GET /requests/{requestId}
→ 200 OK
{
  "requestId": "0x...",
  "status": "complete",
  "data": "0x...",
  "signature": "0x...",
  ...
}
```

Status transitions: `pending → processing → complete | failed`.

The async model naturally supports:

- AI inference APIs with seconds-long generation times
- Human-in-the-loop services where a person reviews and responds
- Multi-step pipelines where the upstream API itself is async
- Any API where response time is unpredictable or long

The airnode doesn't distinguish between these cases. It calls the upstream API and waits (or polls) for a result. The
same signed response format is returned regardless of how long it took.

### Streaming

For APIs that produce incremental output (chat completions, live data):

```
POST /endpoints/{endpointId}
Headers: Accept: text/event-stream

→ 200 OK
Content-Type: text/event-stream

data: {"chunk": "The price", "index": 0}
data: {"chunk": " of BTC", "index": 1}
data: {"chunk": " is $67,432", "index": 2}
data: {"done": true, "requestId": "0x...", "data": "0x...", "signature": "0x..."}
```

Intermediate chunks are unsigned — they're streamed for UX. The final event contains the complete signed response over
the aggregated result. Only the final signed data can be submitted on-chain.

This makes Airnode compatible with OpenAI's chat completion streaming format. An endpoint pointing at
`https://api.openai.com/v1/chat/completions` with streaming enabled works natively.

## Authentication and payment

The airnode operator configures which auth methods each endpoint accepts. Multiple methods can be enabled per endpoint.

### x402 (HTTP-native payment)

```
POST /endpoints/{endpointId}
→ 402 Payment Required
{
  "amount": "1000000",
  "token": "0xA0b8...USDC",
  "network": 8453,
  "recipient": "0x..."
}

Client pays, then retries:

POST /endpoints/{endpointId}
Headers: X-Payment-Proof: 0x...
→ 200 OK with signed data
```

Payment happens before the API call. No escrow, no post-fulfillment charging, no trust that the airnode will charge
honestly. The client pays, the airnode serves. If the airnode doesn't serve, the client doesn't retry — the payment
proof is scoped and can be disputed.

### NFT keys

```
POST /endpoints/{endpointId}
Headers: Authorization: Bearer <EIP-4361-signed-message>
→ 200 OK
```

The signed message proves the caller controls an address. The airnode verifies the signature and checks (cached) that
the address holds an NFT from the operator's access key collection.

An NFT key is a token that grants access to an airnode's endpoints. The operator deploys an ERC-721 or ERC-1155
collection and mints keys with metadata that defines the access grant:

```
struct KeyMetadata {
    bytes32[] endpointIds;   // which endpoints (empty = all)
    uint256 rateLimit;        // requests per day (0 = unlimited)
    uint256 expiry;           // unix timestamp (0 = no expiry)
}
```

#### Access tiers

NFT key metadata controls what the holder can do:

- **Unlimited** — access to all endpoints, no rate limit, no expiry. Like an API key but tradeable and revocable.
- **Endpoint-scoped** — access to specific endpoint IDs only. Different NFTs for different data feeds. An operator could
  sell a "price feeds" key and a "weather data" key separately.
- **Rate-limited** — N requests per day. Higher-tier NFTs get higher limits. The airnode tracks usage per NFT ID and
  enforces the cap.
- **Time-bound** — expiration timestamp in the metadata or contract. Subscription model as an NFT. When it expires, the
  airnode rejects requests. The operator can issue renewals as new mints or metadata updates.
- **Usage-metered** — prepaid credit that decrements per request. When depleted, access stops. Requires an on-chain or
  off-chain balance tracker.

Tiers can combine: a key could be endpoint-scoped + rate-limited + time-bound.

#### Why NFTs instead of API keys

- **Tradeable.** A client who no longer needs access can sell or transfer the NFT on a secondary market. The operator
  can earn royalties on resales.
- **Transparent supply.** The total number of access keys is visible on-chain. The operator can cap the collection size
  (e.g., limited to 100 subscribers).
- **Composable.** Other contracts can check NFT ownership. A DeFi protocol could require "must hold this data NFT" as a
  condition for using their service.
- **Multi-operator bundles.** A single NFT could grant access to multiple airnodes if the operators agree — a "data
  bundle" key.
- **No backend needed.** The operator doesn't need to manage API key databases. The NFT contract is the access list. The
  airnode reads it.

#### Verification

The airnode auth flow for NFT keys:

1. Client sends `Authorization: Bearer <EIP-4361-signed-message>` proving they control an address
2. Airnode verifies the EIP-4361 signature, extracts the address
3. Airnode checks (cached, refreshed periodically) that the address holds an NFT from the operator's collection
4. Airnode reads the NFT metadata: endpoint scope, rate limit, expiry
5. Airnode checks the requested endpoint is in scope and rate limit isn't exceeded
6. If valid, serve the request

The ownership check requires an RPC call to the NFT contract's chain. This is cached aggressively (e.g., refresh every
60 seconds) to avoid per-request latency. The tradeoff: after an NFT transfer, there's a window where the old owner
still has access and the new owner doesn't. A 60-second cache means 60-second transfer lag — acceptable for most use
cases.

#### Configuration

```yaml
# On an API or endpoint
auth:
  - type: nftKey
    chain: 8453
    rpc: https://mainnet.base.org
    contract: '0x...'
    cacheTtl: 60000 # refresh ownership every 60s
```

The airnode needs RPC access to the chain where the NFT collection lives. This is the one place where the airnode has a
chain dependency — but it's read-only (no keys, no gas, no transactions).

### API key

```
POST /endpoints/{endpointId}
Headers: X-Api-Key: sk_live_...
→ 200 OK
```

Traditional API key auth for free tiers, partners, or internal use.

### No auth

```
POST /endpoints/{endpointId}
→ 200 OK
```

Public endpoints. No payment, no authentication. Useful for public goods data or promotional access.

## On-chain verification

### Verifier contract

The minimal on-chain contract. Its only job: verify the airnode's signature and forward the data to a callback.

```vyper
@external
def verify_and_fulfill(
    airnode: address,
    request_id: bytes32,
    data: Bytes[MAX_DATA_LENGTH],
    signature: Bytes[65],
    callback_address: address,
    callback_selector: bytes4,
):
    # Verify signature
    hash: bytes32 = keccak256(concat(request_id, keccak256(data)))
    recovered: address = self._recover_signer(hash, signature)
    assert recovered == airnode, "invalid signature"

    # Prevent replay
    assert not self.fulfilled[request_id], "already fulfilled"
    self.fulfilled[request_id] = True

    # Forward to callback
    raw_call(
        callback_address,
        concat(callback_selector, _abi_encode(request_id, data)),
        max_outsize=0,
        revert_on_failure=False,
    )

    log Fulfilled(request_id, airnode, callback_address)
```

No sponsorship. No escrow. No authorization. Anyone can submit signed data — the requester, a relayer, or the airnode
itself. The contract doesn't care who pays gas; it only cares whether the signature is valid.

### Timestamp verification

The verifier can optionally enforce freshness:

```vyper
@external
def verify_and_fulfill_with_freshness(
    airnode: address,
    request_id: bytes32,
    timestamp: uint256,
    data: Bytes[MAX_DATA_LENGTH],
    signature: Bytes[65],
    callback_address: address,
    callback_selector: bytes4,
    max_age: uint256,
):
    assert block.timestamp - timestamp <= max_age, "stale data"
    # ... same verification and forwarding
```

The timestamp is part of the request ID derivation, so it's covered by the signature. The caller sets `max_age` to
control how fresh the data must be.

### Quorum verification

For high-value use cases, require multiple independent airnodes to agree:

```vyper
@external
def verify_quorum(
    airnodes: DynArray[address, 10],
    request_id: bytes32,
    data: Bytes[MAX_DATA_LENGTH],
    signatures: DynArray[Bytes[65], 10],
    threshold: uint256,
    callback_address: address,
    callback_selector: bytes4,
):
    valid_count: uint256 = 0
    hash: bytes32 = keccak256(concat(request_id, keccak256(data)))

    for i: uint256 in range(10):
        if i >= len(airnodes):
            break
        recovered: address = self._recover_signer(hash, signatures[i])
        if recovered == airnodes[i]:
            valid_count += 1

    assert valid_count >= threshold, "insufficient quorum"
    # ... forward to callback
```

The client calls multiple airnodes via HTTP, collects signed responses, and submits them together. If the data differs
between airnodes, the client can take the median (for numeric data) and submit with a modified quorum function that
accepts varying data values.

### No on-chain registry

Identity and discovery don't require a contract. An on-chain registry would force operators to pay gas to register on
every chain — friction that works against adoption.

**Identity** is solved by DNS. ERC-7529 lets an airnode prove it controls a domain by publishing its address in a DNS
TXT record at `ERC-7529.{chainId}._domaincontracts.{domain}`. The domain is the identity. No on-chain registration
needed.

**Discovery** is a directory problem, not an on-chain problem. A static JSON file, an API endpoint, or a
community-maintained list of airnodes and their endpoint IDs works. The endpoint ID is verifiable by construction —
anyone who knows the API specification can derive the expected ID locally and check it against what the airnode serves.
No contract needed to confirm it.

**Quorum verification** doesn't need a registry either. The caller passes airnode addresses directly to the verifier
contract. The caller decides which airnodes to trust — the contract just checks signatures.

The only loss is permissionless, censorship-resistant discovery (anyone can register, nobody can remove you). In
practice, airnodes are discovered through documentation, integrator relationships, or directories. Gas fees to register
are friction that works against adoption.

## Relayer

For contracts that need on-chain request-response without an off-chain client, a relayer bridges the gap:

```
┌──────────────┐    event     ┌─────────┐    HTTP     ┌─────────┐
│   Contract   │ ───────────→ │ Relayer │ ──────────→ │ Airnode │
│ (emits req)  │              │         │             │  (HTTP) │
│              │ ←─────────── │         │ ←────────── │         │
│  (callback)  │   verify tx  │         │ signed data │         │
└──────────────┘              └─────────┘             └─────────┘
```

The relayer is a separate, simple process:

1. Watch for request events on-chain (or receive webhooks)
2. Call the airnode's HTTP endpoint with the request parameters
3. Receive signed data
4. Submit to the verifier contract, which forwards to the callback

The airnode doesn't know or care that a relayer is involved. From the airnode's perspective, it received an HTTP request
and returned a signed response. Who submits it on-chain is not its concern.

### Properties

- **Stateless.** No persistent storage. If it crashes, restart and re-scan.
- **Replaceable.** Multiple relayers can serve the same airnode. If one goes down, others continue.
- **Chain-specific.** Each relayer watches one chain. The airnode serves all chains via a single HTTP interface.
- **Competitive.** Relayers can compete for fulfillment rewards. First to submit wins. This creates natural redundancy
  without coordination.
- **Independent.** The relayer doesn't need the airnode's private key. It only needs the airnode's HTTP URL.

The relayer inherits log-scanning problems (L2 log pruning, RPC unreliability), but these are isolated from the airnode.
The airnode is unaffected by chain infrastructure issues. The relayer can use alternative detection methods — WebSocket
subscriptions, TheGraph indexers, direct RPC streaming — without changing the airnode.

The relayer can also be eliminated entirely for use cases where the client has an off-chain component (browser dApp,
backend service, AI agent). Those clients call the airnode directly and submit on-chain themselves.

## Processing pipeline

### Request handling

When the airnode receives an HTTP request:

1. **Authenticate** — verify payment (x402), token ownership, API key, or pass through
2. **Resolve endpoint** — map `endpointId` to endpoint definition
3. **Build upstream request** — resolve parameters (fixed → request → default), construct URL, apply upstream API auth
   (API keys, bearer tokens)
4. **Call upstream API** — HTTP fetch with timeout
5. **Process response** — JSONPath extraction (`_path`), type casting (`_type`), multiplier (`_times`), ABI encoding
6. **Sign** — EIP-191 signature over `keccak256(requestId || keccak256(data))`
7. **Return** — signed response as HTTP response body

### Worker pool

Each incoming HTTP request is dispatched to a worker thread that performs steps 3-6 in isolation. The main thread
handles HTTP I/O and authentication.

```
main thread                          worker threads
┌──────────────────────┐             ┌───────────────┐
│  HTTP server         │  dispatch   │  Worker 1     │
│  - accept request    │ ──────────→ │  - API call   │
│  - authenticate      │             │  - process    │
│  - send response     │ ←────────── │  - sign       │
│                      │   result    │  - return     │
│                      │             ├───────────────┤
│                      │  dispatch   │  Worker 2     │
│                      │ ──────────→ │  ...          │
│                      │             ├───────────────┤
│                      │             │  Worker N     │
│                      │             │  ...          │
└──────────────────────┘             └───────────────┘
```

Worker pool size is configurable. Workers are reused across requests. If a worker times out, it's terminated and
replaced.

For async requests, the worker hands off to a queue after the upstream API call starts. The queue stores the pending
request and a worker picks it up when the upstream API responds.

### Plugin hooks

Plugins intercept the pipeline at defined points:

| Hook                | When                        | Can mutate?           |
| ------------------- | --------------------------- | --------------------- |
| `onHttpRequest`     | HTTP request received       | Yes — reject/filter   |
| `onPaymentVerified` | Payment confirmed           | No — observe          |
| `onBeforeApiCall`   | Before upstream API call    | Yes — modify params   |
| `onAfterApiCall`    | After upstream API response | Yes — modify response |
| `onBeforeSign`      | Before signing              | Yes — modify data     |
| `onResponseSent`    | After HTTP response sent    | No — observe          |
| `onError`           | On error at any stage       | No — observe          |

If any plugin registers a mutating hook (`onBeforeApiCall`, `onAfterApiCall`, `onBeforeSign`), the worker pool is
bypassed for that request and processing runs on the main thread. This ensures plugins can intercept the data flow when
needed.

Each plugin has a total time budget per request. If the budget is exhausted, the hook is skipped and the request
proceeds without plugin intervention (or is dropped, depending on configuration).

#### Code mode plugins

For crypto-native operators who want full control over the API call:

```typescript
const plugin: AirnodePlugin = {
  name: 'custom-aggregator',
  hooks: {
    onBeforeApiCall: async (context) => {
      // Skip the configured API entirely
      // Call multiple sources, aggregate, return
      const [binance, coinbase] = await Promise.all([
        fetch('https://api.binance.com/...'),
        fetch('https://api.coinbase.com/...'),
      ]);
      const median = computeMedian(binance, coinbase);
      return { override: { data: median, status: 200 } };
    },
  },
};
```

The plugin takes full control of the API call. The endpoint configuration is still required (it defines the endpoint ID
and reserved parameters for encoding), but the actual HTTP call is replaced by plugin logic.

## Caching, push, and data feeds

The core model is pull: client requests, airnode responds. But for data feeds and high-traffic endpoints, the airnode
should also support push and caching.

### Pull with cache

For popular endpoints where many clients request the same data within a short window, the airnode caches and re-serves
signed responses.

```yaml
endpoints:
  - name: btcUsd
    cache:
      maxAge: 5000 # reuse response for 5 seconds
```

When a cached response exists and hasn't expired:

- The airnode returns the same `data` and `signature`
- The `requestId` and `timestamp` match the original request that populated the cache
- The client receives a response header: `X-Cache: HIT, age=2300`

This is safe because the signature covers the data, not the requester's identity. Any client can use the same signed
data. The on-chain verifier doesn't care who originally requested it — it only checks the airnode's signature.

### Push to cache server

For data feed use cases, the airnode can also push signed data to a separate cache server on a timer:

```
┌─────────┐   timer    ┌───────────────┐   POST batch   ┌──────────────┐
│ Airnode  │ ─────────→ │  call API     │ ─────────────→ │ Cache server │
│         │            │  process       │                │              │
│         │            │  sign          │                │  stores by   │
│         │            │  push          │                │  endpointId  │
└─────────┘            └───────────────┘                └──────┬───────┘
                                                               │
                                                    GET /endpoints/{id}
                                                               │
                                                        ┌──────┴───────┐
                                                        │   Clients    │
                                                        └──────────────┘
```

The cache server is a thin, stateless HTTP server. It receives batches of signed data, verifies signatures before
storing, and serves the freshest data per endpoint. It has no private keys, no API credentials, and no business logic.
Anyone can run one.

This separates concerns cleanly:

- **Airnode** — signs data (has keys, has API credentials, has business logic)
- **Cache server** — stores and serves signed data (stateless, replaceable, scalable)
- **Client** — reads from the cache or requests directly from the airnode

Multiple cache servers can be deployed for redundancy and geographic distribution. Each receives the same signed data
and serves the same responses. If a cache server goes down, clients switch to another or fall back to requesting the
airnode directly.

### Push configuration

```yaml
endpoints:
  - name: btcUsd
    push:
      interval: 5000 # call upstream API and push every 5 seconds
      targets:
        - https://cache-1.example.com
        - https://cache-2.example.com
```

The `push` configuration is per-endpoint. When configured, the airnode runs a background loop that calls the upstream
API on a timer, processes the response, signs it, and POSTs the signed data to each target. The push targets are cache
servers.

Endpoints can have both `cache` (for direct requests) and `push` (for data feeds) simultaneously. A request-response
endpoint with a 5-second cache serves most clients from cache, while a push target receives fresh data every 5 seconds
for downstream consumers.

### Delayed endpoints

A cache server (or the airnode itself) can serve intentionally delayed data. The delay is configured per access tier:

```yaml
# Cache server config
endpoints:
  - path: /realtime
    delaySeconds: 0
    auth: [x402, apiKey]

  - path: /delayed
    delaySeconds: 60
    auth: [free]
```

The same signed data serves both tiers. The delayed endpoint filters by timestamp — it only returns data that's at least
N seconds old. This is useful for:

- **Freemium models:** real-time data for paying clients, 60-second delayed data for free
- **Regulatory compliance:** some data must be delayed before public distribution
- **OEV protection:** delay reveals to prevent front-running

The delay is enforced by the cache server, not the airnode. The airnode signs data as soon as it has it. The cache
server decides what to serve based on its endpoint configuration. This means the same airnode can feed both real-time
and delayed cache servers without knowing or caring about the delay policy.

### Data feeds as a special case

A data feed is a push endpoint with a short interval and a cache server that clients read from. No separate pub-sub
contract. No subscription management. No dedicated update transactions.

```
data feed = push(interval: 5s) + cache server + clients read from cache
```

This unifies the data feed and request-response models. A "data feed" is just a pushed signed API endpoint. The same
airnode process, the same signing logic, the same endpoint ID, the same verification chain. The difference is only in
delivery: push vs pull.

### Beacon ID

A beacon is a specific data point: one airnode's signed response for one endpoint. The beacon ID is a globally unique
identifier:

```
beaconId = keccak256(airnode, endpointId)
```

Because the endpoint ID is specification-bound (commits to the API URL and extraction rules), the beacon ID uniquely
identifies "this airnode's view of this specific data from this specific API." Two independent airnodes serving the same
API produce different beacon IDs (different airnode address) but the same endpoint ID (same API specification).

Beacon IDs are the primary key for data feed storage. The cache server stores signed data keyed by beacon ID. Clients
query by beacon ID to get the latest signed data from a specific airnode for a specific data point.

A data feed that aggregates multiple airnodes is a set of beacons with the same endpoint ID but different airnode
addresses. The consumer collects signed data for each beacon, takes the median, and submits with the quorum verifier.

## Configuration

The config is a single YAML file with four top-level sections: `server`, `apis`, `settings`, and `version`.

### Structure

```yaml
version: '1.0'

server: # HTTP server settings
apis: # upstream API definitions and their endpoints
settings: # global settings (timeouts, workers, proof mode, plugins)
```

`auth` only appears once in the config and always means client-facing access control (how clients authenticate and pay).
Upstream API credentials are just `headers` on the API — simple key-value pairs, no abstraction layer.

Properties like `auth` and `cache` can be set at the API level as defaults. Endpoints inherit them and can override when
needed. An endpoint-level value fully replaces the API-level default (no merging).

### Full example

```yaml
version: '1.0'

# =============================================================================
# Server
# =============================================================================

server:
  port: 3000
  host: 0.0.0.0
  cors: ['*'] # allowed origins, or '*' for all
  rateLimit:
    window: 60000 # time window in ms
    max: 100 # max requests per window per client

# =============================================================================
# APIs
# =============================================================================

apis:
  # --- CoinGecko -------------------------------------------------------------
  - name: CoinGecko
    url: https://api.coingecko.com/api/v3
    headers: # sent with every request to this API
      X-Cg-Pro-Api-Key: ${COINGECKO_API_KEY}
    # Default client auth for all endpoints in this API
    auth:
      - type: x402
        network: 8453
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
        amount: '1000'
      - type: apiKey
    # Default cache for all endpoints in this API
    cache:
      maxAge: 5000

    endpoints:
      # BTC/USD price — inherits auth and cache from API level
      - name: price
        path: /simple/price
        parameters:
          - name: ids
            in: query
            required: true
          - name: vs_currencies
            in: query
            fixed: usd
          - name: x_partner_id
            in: header
            fixed: 'partner-abc-123'
            secret: true # excluded from endpoint ID hash and proofs
        encoding:
          type: int256
          path: $.bitcoin.usd
          times: 1000000
        push:
          interval: 5000
          targets:
            - https://cache-1.example.com
            - https://cache-2.example.com

      # Multi-coin prices — raw JSON signing, inherits auth from API level
      - name: prices
        path: /simple/price
        parameters:
          - name: ids
            in: query
            required: true
          - name: vs_currencies
            in: query
            required: true
        # No `encoding` → raw mode: signs the full JSON response as-is

      # OHLC data — overrides auth, NFT key holders only
      - name: ohlc
        path: /coins/{id}/ohlc
        parameters:
          - name: id
            in: path
            required: true
          - name: vs_currency
            in: query
            fixed: usd
          - name: days
            in: query
            required: true
        encoding:
          type: bytes
          path: $
        auth: # overrides API-level auth
          - type: nftKey
            chain: 8453
            contract: '0x1234...'
            cacheTtl: 60000

      # Ping — overrides auth, free and public
      - name: ping
        path: /ping
        auth: # overrides API-level auth
          - type: free
        cache: # overrides API-level cache
          maxAge: 60000

  # --- OpenAI ----------------------------------------------------------------
  - name: OpenAI
    url: https://api.openai.com/v1
    headers:
      Authorization: Bearer ${OPENAI_API_KEY}
    auth:
      - type: x402
        network: 8453
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
        amount: '50000'

    endpoints:
      - name: chat
        path: /chat/completions
        method: POST
        parameters:
          - name: model
            in: body
            fixed: gpt-4o
          - name: messages
            in: body
            required: true
        encoding:
          type: string
          path: $.choices[0].message.content
        # Inherits x402 auth from API level. No cache — every request is unique.

  # --- Public API (no upstream credentials, no client auth) ------------------
  - name: WeatherAPI
    url: https://api.open-meteo.com/v1
    auth:
      - type: free
    cache:
      maxAge: 60000

    endpoints:
      - name: temperature
        path: /forecast
        parameters:
          - name: latitude
            in: query
            required: true
          - name: longitude
            in: query
            required: true
          - name: current
            in: query
            fixed: temperature_2m
        encoding:
          type: int256
          path: $.current.temperature_2m
          times: 100
        # Inherits free auth and 60s cache from API level

# =============================================================================
# Settings
# =============================================================================

settings:
  timeout: 30000 # overall request timeout in ms
  workers: 4 # worker pool size
  proof: none # none | replay | tee
  plugins:
    - source: ./plugins/heartbeat.ts
      timeout: 5000 # max ms this plugin can consume per request
```

### Key design decisions

**API-level defaults, endpoint-level overrides.** `auth`, `cache`, and other properties can be set on the API. Endpoints
inherit them by default and only specify overrides when they differ. This avoids repeating the same auth block across 15
endpoints. An endpoint-level value fully replaces the API-level default — no merging, simple mental model.

**`headers` for upstream credentials, `auth` for client access.** `headers` is a key-value map of HTTP headers sent with
every request to the upstream API. Upstream API keys and bearer tokens are just headers — no abstraction layer needed.
`auth` always means client-facing access control. There's no ambiguity because the two concepts use different field
names.

**`encoding` replaces `reservedParameters`.** The `encoding` block says what it does: extract a value at `path`,
multiply by `times`, and ABI-encode as `type`. When `encoding` is omitted, the airnode signs the raw JSON response (raw
mode).

**`fixed` and `secret` on parameters.** A parameter with `fixed: usd` is baked into every request and included in the
endpoint ID derivation. The client can't override it. A parameter with `secret: true` has its value replaced with
`<secret>` before endpoint ID hashing and redacted from proofs. Parameters using `${...}` references are treated as
secret automatically.

**`proof: none | replay | tee`.** A single setting that controls the proof mode for the entire deployment. `replay`
includes the `spec` and raw response body in every response. `tee` wraps the process in an enclave. TLSNotary will be
added as a future option when it matures.

## Proof architecture

### Trust assumptions

Every signed API response carries four trust assumptions. Different proof modes address different subsets:

| #   | Trust assumption        | `none`         | `replay`        | `tee`             | `tlsnotary` (future)  |
| --- | ----------------------- | -------------- | --------------- | ----------------- | --------------------- |
| 1   | API response is genuine | Trust operator | Trust operator  | Hardware enforced | TLS transcript proven |
| 2   | Processing is correct   | Trust operator | Replay verified | Hardware enforced | Replay verified       |
| 3   | Correct API was called  | Trust operator | Trust operator  | Hardware enforced | Full request proven   |
| 4   | Signing key is secure   | Trust operator | Trust operator  | Key in enclave    | Trust operator        |

**Today**, the practical options are:

- **`none` + quorum** — multiple independent operators serve the same endpoint ID. Fabrication requires collusion. This
  is the baseline trust model.
- **`replay`** — anyone can verify the extraction was done correctly given the raw response. The operator could still
  fabricate the raw response.
- **`tee`** — a TEE enclave enforces the full pipeline. Trust shifts to the hardware manufacturer. Production-ready with
  AWS Nitro.

**In the future**, TLSNotary will address assumptions 1 and 3 without hardware trust, but it is not yet stable enough
for production use.

### Verification levels

The verification chain builds incrementally. Each level adds guarantees:

**Level 1 — Signature only (proof mode: `none`)**

```
signature ← covers (requestId, data) → recoverable to airnode address
```

Proves: the airnode key holder endorsed this data. Proves nothing about where it came from.

**Level 2 — Signature + replay (proof mode: `replay`)**

```
spec ← endpoint specification included in response
    ↓
endpointId ← re-derive from spec, confirm it matches
    ↓
replay extraction ← apply spec's reserved params to raw response body
    ↓
data ← confirm replay output matches signed data
    ↓
signature ← valid
```

Proves: the signed data was correctly extracted from the raw response using the committed extraction rules. The operator
could still fabricate the raw response.

**Level 3 — Signature + replay + TEE (proof mode: `tee`)**

```
TEE attestation ← proves code hash + config hash
    ↓
code is unmodified open-source airnode binary
    ↓
config defines the API URL and extraction rules
    ↓
all API calls, processing, and signing happen inside the enclave
```

Proves: the entire pipeline ran in a trusted enclave. Trust shifts to the hardware manufacturer.

**Level 4 — Signature + replay + TLS proof (proof mode: `tlsnotary`, future)**

```
TLS proof ← proves the full HTTP request and response
    ↓
spec ← endpoint specification included in response
    ↓
verify: TLS proof request matches spec (server, path, fixed params, client params)
    ↓
endpointId ← re-derive from spec, confirm it matches
    ↓
replay extraction ← apply spec's reserved params to proven response body
    ↓
data ← confirm replay output matches signed data
    ↓
signature ← valid
```

Proves: the full HTTP exchange happened with the claimed server, the correct path and parameters were used, the response
is genuine, and the extraction is correct. No hardware trust required.

### Deterministic replay (available now)

The cheapest proof: publish enough information for anyone to replay the extraction computation. This proves the
processing was correct, but does not prove the raw response is genuine (the operator could fabricate the response body).
To prove the response is genuine, add TLS proofs.

The response includes the endpoint spec and the raw response body:

```json
{
  "requestId": "0x...",
  "endpointId": "0xabc123...",
  "data": "0x...",
  "signature": "0x...",
  "spec": {
    "baseUrl": "https://api.coingecko.com/api/v3",
    "path": "/simple/price",
    "method": "GET",
    "fixedParams": { "vs_currencies": "usd" },
    "reservedParameters": [
      { "name": "_type", "value": "int256" },
      { "name": "_path", "value": "$.bitcoin.usd" },
      { "name": "_times", "value": "1000000" }
    ]
  },
  "processingInputs": {
    "responseBody": "{\"bitcoin\":{\"usd\":67432.12}}"
  }
}
```

The verifier:

1. Re-derives endpoint ID from `spec` → confirms it matches `endpointId`. If the operator lies about the spec, the hash
   won't match.
2. Applies `spec.reservedParameters` to `processingInputs.responseBody`:
   - `_path: $.bitcoin.usd` → extracts `67432.12`
   - `_times: 1000000` → multiplies to `67432120000`
   - `_type: int256` → ABI-encodes
3. Confirms the output matches `data`
4. Verifies the signature

This proves: given this response body and this extraction spec, the signed `data` is the only possible output. The
verifier doesn't need prior knowledge — the `spec` is self-contained and verified against the `endpointId` hash.

What it doesn't prove: that the response body is genuine. The operator could fabricate the `responseBody`. To close that
gap, add a TLS proof (see below).

### TLS proofs (TLSNotary / DECO) — future

TLSNotary is not yet stable for production (TLS 1.2 only, 2-5x latency, limited library maturity). This section
describes the target design for when it is ready.

A TLS transcript proof that the full HTTP exchange (request + response) happened with the claimed server. The response
includes the endpoint specification so the verifier can check everything without prior knowledge:

```json
{
  "requestId": "0x...",
  "endpointId": "0xabc123...",
  "data": "0x...",
  "signature": "0x...",
  "spec": {
    "baseUrl": "https://api.coingecko.com/api/v3",
    "path": "/simple/price",
    "method": "GET",
    "fixedParams": { "vs_currencies": "usd" },
    "reservedParameters": [
      { "name": "_type", "value": "int256" },
      { "name": "_path", "value": "$.bitcoin.usd" },
      { "name": "_times", "value": "1000000" }
    ]
  },
  "proof": {
    "type": "tlsnotary",
    "request": "GET /api/v3/simple/price?ids=bitcoin&vs_currencies=usd HTTP/1.1",
    "host": "api.coingecko.com",
    "responseBody": "{\"bitcoin\":{\"usd\":67432.12}}",
    "redacted": ["headers.x-api-key"],
    "attestation": "base64...",
    "notaryPublicKey": "0x..."
  }
}
```

The verifier checks:

1. **Notary attestation is valid** — the MPC proof confirms the request and response are from a real TLS session
2. **Server matches spec** — `proof.host` matches the host in `spec.baseUrl`
3. **Path matches spec** — `proof.request` path matches `spec.baseUrl` path + `spec.path`
4. **Fixed params present** — `proof.request` query contains all `spec.fixedParams`
5. **Client params present** — `proof.request` query contains the requested parameters
6. **Endpoint ID matches spec** — re-derive endpoint ID from `spec` fields, confirm it equals the signed `endpointId`.
   If the operator lies about the spec, the hash won't match.
7. **Replay extraction** — apply `spec.reservedParameters` to `proof.responseBody`, confirm the output matches `data`
8. **Signature valid** — recover airnode address from signature over `keccak256(requestId || keccak256(data))`

This is self-contained. The verifier doesn't need prior knowledge of the endpoint specification. The `spec` provides the
preimage, the `endpointId` is the hash, and the TLS proof anchors both to the actual HTTP exchange. If any piece is
fabricated, the verification fails — a fake spec produces a wrong endpoint ID, a fake proof fails the notary
attestation, a fake response fails the replay.

**Limitations:**

- 2-5x latency penalty due to MPC rounds with the notary
- Requires a notary server (another trust point unless decentralized)
- TLS 1.2 only today; TLS 1.3 support in development
- Proof size scales with response size

### TEE attestation (Intel TDX / AWS Nitro / AMD SEV-SNP)

Run the entire airnode inside a trusted execution environment. The TEE attests: "this exact binary, with this config
hash, processed this request."

```json
{
  "proof": {
    "type": "tee",
    "platform": "nitro",
    "attestation": "base64...",
    "codeHash": "0x...",
    "configHash": "0x..."
  }
}
```

The verifier checks:

1. `codeHash` matches the published open-source airnode binary
2. The TEE attestation is valid for the claimed platform
3. `configHash` in the attestation can be used to audit the full config if the operator publishes it — but this is
   optional and only meaningful because the TEE enforces it

TEE collapses assumptions 1-3 into one: trust the hardware manufacturer. The key is generated inside the enclave and
never leaves. The config is loaded inside and its hash is attested. The API call, processing, and signing all happen
inside the enclave.

The config hash is only meaningful here because the TEE enforces it — the hardware guarantees the code loaded that
specific config. Outside of TEE, the config hash is a self-reported claim with no enforcement mechanism. The endpoint ID
remains the primary verifiable commitment regardless of proof mode.

**Limitations:**

- Trust shifts to hardware manufacturer (Intel, AMD, AWS)
- Side-channel attack history (SGX: Foreshadow, Plundervolt; evolving for TDX/SEV)
- Key recovery on enclave destruction requires a migration protocol
- Reproducible builds needed for code hash verification
- Enclave operator controls availability (can refuse to run)

### Endpoint verification without a registry

A client who wants "CoinGecko BTC/USD as int256 with 6 decimals" can derive the expected endpoint ID locally from the
API specification. They use this to find airnodes that claim to serve it. The endpoint ID alone doesn't prove the
airnode actually calls that API — but with a TLS proof, the client can verify the full HTTP request matches the spec
they used to derive the ID. No on-chain registry needed.

Discovery happens off-chain: directories, documentation, integrator relationships. The endpoint ID is the common
identifier that links them. Two clients independently deriving the same endpoint ID from the same API specification will
get the same hash — this is the content-addressed property that makes discovery work without a registry.

### Proof modes

The airnode supports proof modes, configurable per deployment:

| Mode        | Proves                          | Latency | Config setting        |
| ----------- | ------------------------------- | ------- | --------------------- |
| `none`      | Signature only (trust operator) | Minimal | `proven: false`       |
| `replay`    | Processing + endpoint binding   | Minimal | `proven: 'replay'`    |
| `tlsnotary` | + API response authenticity     | 2-5x    | `proven: 'tlsnotary'` |
| `tee`       | Full pipeline (trust hardware)  | Minimal | `proven: 'tee'`       |

Each mode is additive. In all modes, the endpoint ID provides endpoint binding by construction. `replay` adds processing
verification. `tlsnotary` adds API response authenticity. `tee` collapses everything into a hardware attestation.

Operators choose based on their threat model and latency tolerance. High-value data feeds might use `tlsnotary` or
`tee`. Public goods data might use `none`. The proof mode can be advertised in the airnode's directory listing or
documentation.

## Advanced patterns

### Multi-airnode aggregation

Because endpoint IDs are specification-bound, two independent airnodes serving the same API with the same extraction
rules produce the same endpoint ID — even with different API keys, servers, or infrastructure. The endpoint ID is a
content-addressed identifier for "this data from this source, extracted this way."

This enables trustless multi-airnode aggregation:

```
client looks up directory: "who serves endpointId 0xabc?"
    → airnode A, airnode B, airnode C

client → airnode A → signed(67432)
client → airnode B → signed(67435)
client → airnode C → signed(67431)
                          ↓
              client computes median(67432)
                          ↓
              submits all 3 signatures + median to quorum verifier
```

No single airnode can fabricate data without colluding with a majority. The quorum verifier confirms all signatures are
for the same endpoint ID — which means all airnodes committed to calling the same API with the same extraction rules.
The on-chain contract doesn't need to trust metadata or operator claims; the endpoint ID is the proof of equivalence.

For numeric data, the contract can verify the median is correct given the individual signed values. For non-numeric
data, unanimous agreement is required.

### Airnode-to-airnode composition

One airnode calls another airnode's endpoint as its upstream API. The config simply points at the other airnode's HTTP
URL:

```yaml
apis:
  - name: AggregatedPrice
    baseUrl: https://airnode-b.example.com
    endpoints:
      - name: btcPrice
        path: /endpoints/0xabc...
```

Airnode A calls Airnode B, receives signed data, and can either pass it through (re-signing) or aggregate multiple
airnode responses. The proof chain composes: Airnode A's response carries Airnode B's signature as nested proof.

### Signed responses as bearer credentials

A signed response is a portable attestation that doesn't require on-chain submission:

- "Airnode X attested that this address has a credit score above 700"
- "Airnode Y attested that this API returned price P at time T"
- "Airnode Z attested that this user passed KYC"

The consumer verifies the signature off-chain, checks the airnode's identity (via DNS/ERC-7529 or a known address), and
decides whether to trust it. No gas, no transaction, no chain interaction. This aligns with W3C Verifiable Credentials —
the signed response could adopt that format.

### Conditional responses

The airnode evaluates a condition before signing:

```json
{
  "parameters": {
    "coinId": "bitcoin",
    "currency": "usd"
  },
  "condition": {
    "operator": "gte",
    "path": "$.bitcoin.usd",
    "value": 60000
  }
}
```

If the condition fails, the airnode returns an unsigned rejection — not an error, but a deliberate "the condition was
not met" response. If it passes, the signed data is returned as normal.

This enables on-chain circuits like: "execute this trade only if the oracle price is above my limit." The signed data
itself proves the condition was met. The contract doesn't need to check.

### Webhook push

Instead of polling for async results, the airnode pushes to a callback URL:

```json
{
  "parameters": { "prompt": "..." },
  "webhook": "https://my-service.com/callback"
}
```

When the result is ready, the airnode POSTs the signed response to the webhook. For on-chain delivery, the "webhook" is
a relayer's HTTP endpoint — the airnode pushes signed data to the relayer, which submits on-chain.

This inverts the relayer relationship: instead of the relayer polling, the airnode pushes. Combined with subscriptions
(defined in config, not on-chain), this becomes: "call this API every N seconds and push signed results to this URL."

### Endpoint marketplace

An off-chain directory (web app, API, or static listing) organized by data source, not by operator. Because endpoint IDs
are specification-bound, the marketplace groups airnodes by what they serve:

```
endpointId 0xabc123... (CoinGecko BTC/USD, int256, 6 decimals)
  ├── Airnode A — proof: tee, price: 0.001 USDC, uptime: 99.9%
  ├── Airnode B — proof: tlsnotary, price: 0.002 USDC, uptime: 99.7%
  └── Airnode C — proof: none, price: free, uptime: 98.5%
```

All three airnodes produce the same endpoint ID because they call the same API with the same extraction rules. The
client chooses based on proof level, price, and reputation — not which operator to trust. The endpoint ID guarantees
they're all serving the same data.

No on-chain registry needed. The marketplace maintains its own index. Operators register by submitting their airnode URL
and endpoint list. The marketplace verifies endpoint IDs by re-deriving them from the published API specifications.

### ChainAPI as marketplace and operator platform

ChainAPI becomes the off-chain platform that ties everything together — operator onboarding, config building, endpoint
directory, and NFT key management:

#### Config builder

Operators build their airnode config through the UI: HTTP server settings, endpoint definitions, auth methods (x402
pricing, NFT key collection, API keys), push targets for data feeds, and plugin selection.

The builder derives and displays endpoint IDs as the operator configures endpoints, making it clear what clients will
use to reference their data.

#### Endpoint directory

When an operator publishes their config through ChainAPI, the platform:

1. Derives all endpoint IDs from the API specification
2. Indexes them in a searchable directory
3. Verifies correctness by re-deriving from the published spec
4. Groups endpoints by data source (all airnodes serving the same endpoint ID)

Clients search by API name, data type, endpoint ID, or description. The directory shows available airnodes for each
endpoint with their pricing, proof mode, and uptime.

This is the marketplace from the previous section — ChainAPI is the natural host for it.

#### NFT key management

Operators create and manage NFT access key collections through ChainAPI:

1. **Create collection** — deploy an ERC-721 or ERC-1155 contract with the access key metadata schema. ChainAPI provides
   the contract template. The operator chooses chain, collection size, and pricing.
2. **Configure tiers** — define access tiers (unlimited, endpoint-scoped, rate-limited, time-bound) as different token
   types or metadata variants.
3. **Mint and distribute** — mint keys to specific addresses, list for sale on the platform, or integrate with existing
   NFT marketplaces.
4. **Monitor** — view holders, track usage, see revenue from primary sales and royalties.
5. **Manage** — update metadata (extend expiry, adjust rate limits), pause or revoke keys if needed.

The operator's airnode config references the NFT collection contract. ChainAPI generates the config entry:

```yaml
# On an API or endpoint
auth:
  - type: nftKey
    chain: 8453
    rpc: https://mainnet.base.org
    contract: '0xABC...' # deployed via ChainAPI
    cacheTtl: 60000
```

#### Plugin marketplace

Operators publish plugins (custom aggregators, logging, alerting, data transformations) to ChainAPI. Other operators
browse, install, and configure them:

```
Plugins
  ├── heartbeat — health monitoring with webhook alerts
  ├── slack-alerts — post fulfillment notifications to Slack
  ├── multi-source-aggregator — call multiple APIs, return median
  ├── response-cache-warmer — pre-populate cache on startup
  └── rate-limit-enforcer — per-client rate limiting with Redis
```

Each plugin has a source URL, version, description, and configuration schema. The config builder integrates plugin
selection and configuration into the setup flow.

#### Operator dashboard

Once deployed, the operator monitors their airnode through ChainAPI:

- Request volume and latency per endpoint
- Revenue from x402 payments and NFT key sales
- Cache hit rates
- Push delivery status (for data feed endpoints)
- Plugin health and budget usage
- NFT key holder analytics

### Optimistic fulfillment with fraud proofs

Instead of proving every response upfront, assume honesty and allow challenges:

1. Airnode posts a bond to an escrow contract
2. Responses are served without proofs (fast, cheap)
3. Anyone can challenge a response by replaying the API call within a time window
4. If the replayed result differs beyond a threshold, the bond is slashed

The challenge: APIs aren't deterministic — prices change. The dispute window needs a timestamped TLS proof of what the
API returned at the original request time. This works for slowly-changing data (identity, KYC, metadata) better than
volatile price feeds.

### AI agents as consumers

The x402 + signed API model maps directly to how AI agents consume tools:

1. Agent discovers airnode endpoints via a directory or tool registry
2. Agent pays per-call via x402 using its crypto wallet
3. Agent receives signed data as a verifiable tool result
4. Agent can prove to its principal: "this data came from this source at this time"

The signed response is a verifiable "function call result" in the agent tool-calling paradigm. The airnode endpoint can
be published as an OpenAI-compatible tool definition:

```json
{
  "type": "function",
  "function": {
    "name": "get_btc_price",
    "description": "Get the current BTC/USD price, signed by a trusted oracle",
    "parameters": {
      "type": "object",
      "properties": {
        "currency": { "type": "string", "default": "usd" }
      }
    }
  }
}
```

## Build sequence

### Phase 1 — HTTP server and signed API

The core. Airnode serves signed responses over HTTP.

- HTTP server with Bun.serve
- Synchronous request handling (endpoint resolution → API call → process → sign → respond)
- Specification-bound endpoint ID derivation
- API key and free-tier authentication
- AirnodeVerifier contract
- Worker pool for concurrent request handling
- Plugin hook system
- Config schema

### Phase 2 — Payment, async, and caching

Monetization, support for slow APIs, and data feed delivery.

- x402 payment integration
- NFT key collections (ERC-721/1155 with access metadata)
- NFT key verification in airnode auth layer
- Async request queue with polling
- SSE streaming for incremental responses
- Webhook push for async completion
- Response caching with configurable maxAge
- Push loop for data feed endpoints
- Cache server (thin HTTP server that stores and serves signed data)
- Delayed endpoints on cache server
- Beacon ID derivation (`keccak256(airnode, endpointId)`)

### Phase 3 — Relayer

On-chain bridge for contracts that need request-response.

- Relayer process (log detection → HTTP call → on-chain submission)
- Multi-chain support (one relayer per chain, single airnode)
- Batch submission via EIP-7702 executor
- Competitive relayer support (multiple relayers, first-to-submit)

### Phase 4 — Proofs

Cryptographic guarantees for third-party operation.

- Deterministic replay (spec + response body in response, endpoint ID re-derivation)
- TEE wrapping (Nitro Enclaves) — production-ready today

### Phase 5 — ChainAPI platform

Operator tooling and marketplace.

- Config builder
- Endpoint directory with specification-bound ID verification
- NFT key collection deployment and management UI
- Plugin marketplace (publish, browse, install)
- Operator dashboard (request volume, revenue, cache metrics)

### Phase 6 — Ecosystem

Aggregation and advanced patterns.

- Multi-airnode quorum verification
- Airnode-to-airnode composition
- Optimistic fulfillment with fraud proofs
- AI agent tool directory integration

### Future — TLS proofs

When TLSNotary (or equivalent) matures to production stability with TLS 1.3 support and acceptable latency, integrate it
as a proof mode. This would close the remaining trust gap (API response authenticity) without hardware trust. See the
[TLS proofs](#tls-proofs-tlsnotary--deco--future) section for the target design.

## Future research

Ideas that are worth exploring but need more design work before they belong in the build sequence.

### Signing layer for existing APIs

API providers have existing HTTP servers. They don't want to learn about crypto, ABI encoding, or endpoint IDs. They
just want their API responses to be verifiable. There are several ways to add a signing layer, ranging from zero effort
to full control.

#### Two approaches: middleware vs. full Airnode server

**Middleware** signs the raw JSON response body as-is. No extraction, no ABI encoding. The response body is never
modified — signatures go in HTTP headers. Existing API clients are unaffected. The endpoint ID is derived from
`keccak256(baseUrl, path, method)`.

Good for: API providers who want verifiable responses with minimal changes. Off-chain consumers (AI agents, bearer
credentials, service-to-service verification). Can also handle monetization (x402, NFT keys, API keys) by checking auth
on the request side before passing to the handler.

**Airnode server** is the full standalone process. It calls the upstream API, extracts values, ABI-encodes, and signs
the encoded data. Returns the signed API Airnode response format. Compatible with on-chain verifier contracts.

Good for: third-party operators, on-chain data delivery, data feeds.

A client who gets a middleware-signed response and needs on-chain data does the extraction and encoding themselves (or
uses a client SDK). The signed raw body + the extraction rules from the endpoint spec give them everything they need.

#### Option 1 — Managed proxy (zero provider effort)

ChainAPI runs the signing proxy as a hosted service. The provider gives ChainAPI their API's public URL. ChainAPI routes
traffic through the proxy, signs responses, and serves them.

```
Client → signed.chainapi.com/proxy/api.example.com/v1/price → api.example.com
                              ↓
                        signs response
                              ↓
Client ← original JSON + signature
```

The provider deploys nothing, changes nothing, manages no keys. Their API is called through a different URL, but the API
itself is unmodified.

The signing key is controlled by ChainAPI, not the provider. The attestation is "ChainAPI observed this response from
this API" rather than "the API provider attests to this data." This is analogous to Cloudflare sitting in front of an
origin server — the provider delegates a function to a trusted intermediary.

The provider can upgrade to holding their own key later by switching to any of the self-hosted options below.

#### Option 2 — Middleware

A library the provider adds to their existing server. It intercepts outgoing responses, signs the raw JSON body, and
adds signature headers. The response body is never modified. It can also enforce auth/payment on incoming requests.

The middleware accepts a config object — the provider loads it however they want (environment variables, secrets
manager, their own config system):

```js
import { withAirnode } from '@api3/airnode';

const app = new Hono();

app.use(
  withAirnode({
    privateKey: process.env.AIRNODE_PRIVATE_KEY,
  })
);

// existing routes unchanged — response body is untouched
app.get('/v1/price', (c) => {
  return c.json({ bitcoin: { usd: 67432.12 } });
});
```

With monetization:

```js
app.use(
  withAirnode({
    privateKey: process.env.AIRNODE_PRIVATE_KEY,
    auth: [{ type: 'x402', network: 8453, token: '0xA0b8...', amount: '1000' }, { type: 'apiKey' }],
  })
);
```

Unauthorized requests get a `402 Payment Required` or `401 Unauthorized` before the handler runs. Authorized requests
pass through, the handler returns a response, and the middleware signs it. Two concerns, one middleware:

```
request → [check auth/payment] → handler → [sign response body] → client
              ↓ reject                          ↓ add headers
           402/401                         original JSON unchanged
```

Per-route overrides:

```js
// Most routes use the global auth
app.use(withAirnode({ privateKey, auth: [{ type: 'x402', ... }] }));

// This route is free
app.get('/v1/ping', withAirnode({ privateKey, auth: [{ type: 'free' }] }), pingHandler);
```

For serverless (Lambda, Vercel, Cloudflare Workers), the same pattern as a handler wrapper:

```js
import { withAirnode } from '@api3/airnode';

export default withAirnode(
  {
    privateKey: process.env.AIRNODE_PRIVATE_KEY,
  },
  async function handler(req) {
    return { bitcoin: { usd: 67432.12 } };
  }
);
```

**Non-JavaScript frameworks** follow the same pattern using their native middleware idiom. The signing logic (keccak256,
ECDSA, header generation) can be shipped as a WASM module that any language calls, or as a native library for languages
with secp256k1 support.

Go:

```go
mux := http.NewServeMux()
mux.HandleFunc("/v1/price", priceHandler)

signed := airnode.Wrap(mux, airnode.Config{
    PrivateKey: os.Getenv("AIRNODE_PRIVATE_KEY"),
    Auth:       []airnode.AuthMethod{{Type: "apiKey"}},
})
http.ListenAndServe(":3000", signed)
```

Python / FastAPI:

```python
from airnode import AirnodeMiddleware

app = FastAPI()
app.add_middleware(AirnodeMiddleware,
    private_key=os.environ["AIRNODE_PRIVATE_KEY"],
    auth=[{"type": "apiKey"}],
)
```

Ruby / Rails:

```ruby
# config/application.rb
config.middleware.use Airnode::Middleware,
  private_key: ENV["AIRNODE_PRIVATE_KEY"],
  auth: [{ type: "apiKey" }]
```

Elixir / Phoenix:

```elixir
# router.ex
pipeline :signed do
  plug Airnode.Plug, private_key: System.get_env("AIRNODE_PRIVATE_KEY")
end
```

The middleware is thin — it hooks into the framework's response lifecycle and calls the signing library. The provider
holds the key and is the airnode.

#### Option 3 — API gateway plugin

Most production APIs sit behind a gateway — Kong, AWS API Gateway, Cloudflare API Shield. A plugin for these gateways
adds signing without new infrastructure.

The provider installs the plugin, configures a signing key, and every response passing through the gateway gets signed.
For Cloudflare, this is a Worker in the response pipeline. For AWS API Gateway, it's a Lambda response transformation.

The provider is already using these tools. They're adding a capability to their existing stack, not adopting something
new.

#### Option 4 — Reverse proxy (Docker container)

A standalone process that sits in front of the API server and proxies all traffic:

```
Client → Sidecar (port 3000) → API server (port 8080)
                ↓
         signs response
                ↓
Client ← original JSON + signature headers
```

Deployed as a Docker container:

```
docker run -e UPSTREAM=http://localhost:8080 \
           -e AIRNODE_PRIVATE_KEY=0x... \
           -p 3000:3000 \
           api3/airnode-sidecar
```

No code changes to the API. The sidecar is a reverse proxy that signs raw JSON responses and adds signature headers. The
provider holds the key. Auth/payment can be configured the same way as the middleware — the proxy rejects unauthorized
requests before forwarding to the upstream.

#### Option 5 — Webhook receiver

The provider doesn't expose a public API — they push data to the signing layer via webhooks. The signing layer signs
whatever it receives and publishes to a cache server.

```
Provider's system → webhook POST → Signing layer → signs → Cache server
                                                              ↓
                                                           Clients
```

This works for push-oriented data: the provider's system fires a webhook when a price updates, when an event occurs,
when a batch job completes. The provider configures a webhook URL in their existing system, and data starts flowing.

#### Option 6 — Database watcher

The signing layer watches the provider's database directly — polling a table, listening to Postgres NOTIFY events, or
subscribing to a Redis pub/sub channel. When a value changes, it signs the new value and publishes to a cache server.

```
Provider's DB → change event → Signing layer → signs → Cache server
```

The API server isn't involved at all. The provider gives the signing layer read-only database credentials and tells it
which tables or keys to watch. Works for data that's stored rather than computed: prices written to a DB, user balances,
feature flags, state values.

#### Option 7 — Client-side TLS proofs

The signing layer runs on the consumer's machine, not the provider's. The consumer uses a TLS proof library when calling
the API. The library intercepts the TLS session and generates a proof that the response came from the claimed server.

```
Client (with TLS prover) → API server
         ↓
   generates proof that response came from api.example.com
         ↓
Client has verifiable data — no signature needed
```

The provider does literally nothing. They don't even know this is happening. The "signed" data is a TLS transcript proof
rather than an ECDSA signature.

The tradeoff: TLSNotary is still maturing (TLS 1.2 only, 2-5x latency). But it's the only option that requires zero
provider involvement of any kind.

#### Comparison

| Option           | Provider effort       | Who holds the key    | Monetization?           |
| ---------------- | --------------------- | -------------------- | ----------------------- |
| Managed proxy    | None                  | ChainAPI             | Yes (proxy enforces)    |
| Middleware       | Add library           | Provider             | Yes (request-side auth) |
| Gateway plugin   | Install plugin        | Provider             | Yes (plugin enforces)   |
| Reverse proxy    | Run a container       | Provider             | Yes (proxy enforces)    |
| Webhook receiver | Configure webhook URL | Sidecar operator     | No (push only)          |
| Database watcher | Grant read access     | Sidecar operator     | No (push only)          |
| Client-side TLS  | None                  | Nobody (proof-based) | No                      |

The managed proxy and client-side TLS options are the most interesting for adoption — they require zero provider effort.
The middleware and serverless wrapper are the best balance of low friction and provider control. The reverse proxy is
the most flexible for complex setups.

#### ChainAPI onboarding flow

ChainAPI ties these options together:

1. Provider enters their API base URL
2. ChainAPI probes the endpoints, discovers response shapes
3. ChainAPI suggests extraction rules for on-chain compatibility (encoded mode)
4. Provider chooses deployment option (managed proxy, middleware snippet, Docker config, etc.)
5. ChainAPI generates the config / code snippet / Docker compose file
6. Provider deploys (or does nothing, for managed proxy)
7. ChainAPI registers the endpoints in the directory

### Response derivatives

An endpoint that doesn't call an upstream API but computes over other endpoints' cached responses:

```yaml
endpoints:
  - name: btcEthRatio
    type: derived
    sources:
      - endpointId: '0xabc...' # BTC/USD
        alias: btc
      - endpointId: '0xdef...' # ETH/USD
        alias: eth
    computation: 'btc / eth'
    reservedParameters:
      - name: _type
        fixed: int256
      - name: _times
        fixed: '1000000'
```

The airnode computes `BTC/USD ÷ ETH/USD` from two cached price feeds and signs the result. No upstream API call. The
signed response includes the source beacon IDs and their timestamps, proving it was derived from specific signed inputs
at specific times.

Use cases:

- Cross-pair ratios (BTC/ETH, EUR/GBP) from USD-denominated feeds
- Portfolio values computed from individual token prices
- Aggregated indices (average of N data points)
- Spread calculations (ask - bid)

The proof chain is interesting: the derivative response carries references to the source data, and anyone with access to
the source signed responses can verify the computation.

### Threshold signing

The airnode's signing key is split across multiple parties via threshold cryptography (e.g., 2-of-3 TSS). No single
party holds the full key. A signing quorum must cooperate to produce each signature.

```
request → party A (key share 1) ─┐
                                   ├─→ threshold signing protocol → signature
request → party B (key share 2) ─┘
          party C (key share 3) — offline (not needed for 2-of-3)
```

This eliminates the "key security" trust assumption without TEE. Even if one party is compromised, signatures can't be
forged. Possible party configurations:

- Operator + HSM + key custodian service
- Three independent operators sharing a single airnode identity
- Operator + two geographically distributed backup signers

The verifier contract doesn't change — it still recovers a single address from the signature. The threshold scheme is
invisible on-chain. The airnode address is derived from the combined public key, not any individual share.

### Signed errors, proof of absence, and SLA proofs

The airnode signs errors and empty responses, not just successful data:

```json
{
  "requestId": "0x...",
  "endpointId": "0x...",
  "timestamp": 1234567890,
  "error": { "type": "http_error", "httpStatus": 404, "message": "Not Found" },
  "signature": "0x..."
}
```

This covers two use cases:

**Proof of absence** — proving a negative result. "The sanctions API confirmed this address has no flags." "The credit
API returned no records for this user." The signed 404 or empty response proves the airnode called the API and got a
specific negative result.

**SLA proofs** — proving downtime. When an upstream API is down (timeout, 500, connection refused), the airnode signs
the error. String enough together and you have a verifiable SLA report: "the API was down for 45 minutes, here are 9
signed proofs of failed attempts." Useful for SLA enforcement or detecting unreliable data sources.

### Response change detection

For push endpoints, the airnode tracks response values over time and only pushes when meaningful changes occur:

```yaml
endpoints:
  - name: btcUsd
    push:
      interval: 1000 # check every second
      targets:
        - url: https://cache.example.com
          trigger:
            type: deviation
            threshold: 0.01 # push only on 1%+ change
        - url: https://alerts.example.com
          trigger:
            type: crossover
            value: 100000 # push when BTC crosses $100k
```

Trigger types:

- **Deviation** — push when value changes by more than N% from the last pushed value
- **Crossover** — push when value crosses a specific threshold (in either direction)
- **Heartbeat** — push at least every N seconds regardless of change (liveness guarantee)
- **Always** — push every update (default, current behavior)

Different push targets can have different triggers. The same endpoint pushes every update to the primary cache server
but only threshold-filtered updates to an alerting webhook. This reduces traffic dramatically for high-frequency data
feeds where most updates are noise.

### Request batching

A client sends multiple endpoint requests in one HTTP call:

```json
POST /batch
{
  "requests": [
    { "endpointId": "0xabc...", "parameters": { "coinId": "bitcoin" } },
    { "endpointId": "0xdef...", "parameters": { "coinId": "ethereum" } },
    { "endpointId": "0x123...", "parameters": { "coinId": "solana" } }
  ]
}
→ 200 OK
{
  "responses": [
    { "requestId": "0x...", "data": "0x...", "signature": "0x..." },
    { "requestId": "0x...", "data": "0x...", "signature": "0x..." },
    { "requestId": "0x...", "data": "0x...", "signature": "0x..." }
  ]
}
```

Each response is independently signed. The batch is a transport optimization, not a semantic unit. The airnode processes
all requests concurrently (one worker per request) and returns when all complete.

Useful for:

- DeFi protocols that need multiple prices atomically
- Portfolio tracking that needs 10+ token prices in one call
- Reducing HTTP overhead and connection setup for high-volume clients

### Versioned response chain

Each signed response for a push endpoint includes the hash of the previous response, creating an append-only hash chain
per beacon:

```json
{
  "requestId": "0x...",
  "data": "0x...",
  "signature": "0x...",
  "previousHash": "0x..."
}
```

The `previousHash` is `keccak256` of the previous complete signed response (including its own `previousHash`). The first
response in the chain has `previousHash: null`.

This gives auditability for free — one extra field per response. A cache server that stores the full chain can prove
completeness: "here are all 1,440 daily updates for this beacon, and the hash chain is unbroken." If any response is
omitted or modified, the chain breaks.

Useful for:

- Regulatory audit trails (prove the data feed was continuous)
- Dispute resolution (prove the airnode published a specific value at a specific time)
- Data feed quality monitoring (detect gaps in push delivery)

### Delegated sub-keys

The airnode's root key delegates signing authority to ephemeral sub-keys with restricted scope:

```json
{
  "type": "delegation",
  "rootKey": "0xABC...",
  "subKey": "0x123...",
  "scope": {
    "endpointIds": ["0xabc...", "0xdef..."],
    "validUntil": 1735689600,
    "maxRequests": 10000
  },
  "signature": "0x..." // signed by root key
}
```

The sub-key signs responses. The root key can revoke at any time by publishing a revocation message. The verifier
contract checks the delegation chain: sub-key signature → delegation message → root key.

Benefits:

- Rotate sub-keys daily without changing the airnode's on-chain identity
- Restrict sub-keys to specific endpoints (operational isolation)
- Time-bound sub-keys that auto-expire (no revocation needed)
- Root key stays in cold storage / HSM, sub-key handles live traffic

The delegation message is published alongside the airnode's identity (in DNS, in the directory, or served at a
well-known URL on the airnode itself: `GET /.well-known/airnode/delegations`).

### MCP server mode

The airnode exposes its endpoints as Model Context Protocol (MCP) tools:

```json
{
  "tools": [
    {
      "name": "get_price",
      "description": "Get cryptocurrency price signed by oracle",
      "inputSchema": {
        "type": "object",
        "properties": {
          "coinId": { "type": "string" },
          "currency": { "type": "string", "default": "usd" }
        },
        "required": ["coinId"]
      }
    }
  ]
}
```

AI agents using Claude, GPT, or any MCP-compatible client discover and call airnode endpoints through their native
tool-use interface. The agent doesn't need to know about signed APIs, endpoint IDs, or ABI encoding — it calls a tool
and gets a result.

The tool response includes the signature and proof as metadata:

```json
{
  "result": { "price": 67432.12 },
  "meta": {
    "requestId": "0x...",
    "endpointId": "0x...",
    "signature": "0x...",
    "data": "0x..."
  }
}
```

The agent can pass the `meta` to its principal for on-chain submission or off-chain verification. The human-readable
`result` is what the agent uses for reasoning. Both come from the same API response — the `meta` is just the signed,
ABI-encoded version.

This makes every airnode endpoint immediately accessible to the AI agent ecosystem without custom integration per agent
framework.

### Multi-value encoding

Current encoding extracts a single value. Many use cases need multiple values from one API call — OHLC (open, high, low,
close), a token's price + market cap + volume, or weather with temperature + humidity + wind speed.

```yaml
encoding:
  - name: open
    type: int256
    path: $.ohlc[0].open
    times: 1000000
  - name: high
    type: int256
    path: $.ohlc[0].high
    times: 1000000
  - name: low
    type: int256
    path: $.ohlc[0].low
    times: 1000000
  - name: close
    type: int256
    path: $.ohlc[0].close
    times: 1000000
```

All values are ABI-encoded together in one signed response. One API call, one signature, multiple on-chain values.
Without this, each field would need a separate endpoint making the same API call.

### GraphQL support

GraphQL APIs are a single endpoint (`/graphql`) with variable queries. The endpoint ID concept doesn't map cleanly
because the path is always the same — the query is what varies.

Approach: named queries are registered as endpoints. The query text (or its hash) becomes part of the endpoint ID
derivation:

```yaml
endpoints:
  - name: tokenPrice
    path: /graphql
    method: POST
    query: |
      query ($id: ID!) {
        token(id: $id) { derivedETH }
      }
    parameters:
      - name: id
        in: variable
        required: true
    encoding:
      type: int256
      path: $.data.token.derivedETH
      times: 1000000000000000000
```

The `query` field is included in the endpoint ID hash. Two operators using the same GraphQL query produce the same
endpoint ID.
