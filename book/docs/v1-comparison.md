---
slug: /v1-comparison
sidebar_position: 2
---

# What changed from v1

Airnode v2 is a ground-up rewrite. This page explains what's different and why.

## HTTP server instead of serverless functions

v1 ran as AWS Lambda or GCP Cloud Functions, deployed via a dedicated CLI (`airnode deployer`). Each invocation was a
cold start — the node spun up, scanned the chain for pending requests, processed them, submitted fulfillment
transactions, and shut down. This cycle repeated every minute.

v2 is a single long-running binary. It starts, listens for HTTP requests, and responds. There are no cloud provider
dependencies, no deployer CLI, and no cold starts. The process runs anywhere — systemd, Docker, bare metal.

**Why:** Serverless added deployment complexity (IAM roles, cloud provider accounts, region selection) without clear
benefit. A long-running process is simpler to operate, debug, and monitor. It also enables in-memory caching, background
push loops, and persistent connections — none of which were possible with stateless Lambda invocations.

## The airnode never touches the chain

v1 scanned chain logs for `RequestMade` events, checked authorization and sponsorship on-chain, and submitted
`fulfill()` transactions. The airnode needed RPC endpoints, managed nonces, estimated gas, and handled transaction
failures.

v2 removes all chain interaction. The airnode is a pure HTTP server. Clients get signed data via HTTP and submit it
on-chain themselves (or a relayer does it for them). The airnode has no RPC config, no nonce management, no gas
estimation, and no pending transaction tracking.

**Why:** Chain interaction was the largest source of complexity and failure modes in v1 — RPC rate limits, reorgs, stuck
transactions, nonce gaps, gas price spikes. Moving chain interaction out of the airnode eliminates all of these. The
airnode does one thing well: call APIs and sign responses.

## One contract instead of thirty

v1 had 30+ Solidity contracts across multiple modules: request-response (AirnodeRrpV1), pub-sub (AirnodePsp),
authorization (RequesterAuthorizerWithAirnode, AccessControlRegistry), sponsor wallets, allocators, subscription slots,
data feeds (Api3ServerV1), OEV auctions, proxies, and more.

v2 has one Solidity contract:

- **AirnodeVerifier** — verifies a signature, prevents replay, and forwards data to a callback contract.

Permissionless, stateless (beyond replay tracking), and no admin functions.

**Why:** Most of v1's contract complexity existed to manage trust between sponsors, requesters, and airnodes on-chain.
With v2's HTTP model, trust is handled at the HTTP layer (API keys, x402 payment). The contract only needs to verify
signatures — everything else is unnecessary.

## YAML config instead of OIS

v1 used a JSON config with Oracle Integration Specifications (OIS) — an intermediate format that described APIs and
their endpoints separately from triggers and chains. Configuring a single price feed required touching `ois`,
`apiCredentials`, `triggers`, and `chains` sections, often with cross-references by name.

v2 uses a flat YAML config with four sections: `version`, `server`, `settings`, `apis`. Endpoints are defined directly
under their API. There is no intermediate specification layer, no triggers, and no chain config.

**Why:** OIS was designed for generality — it could describe any API interaction. In practice, the abstraction added
complexity without proportional benefit. Most operators just wanted to say "call this URL, extract this value, sign it."
The v2 config does exactly that.

## Specification-bound endpoint IDs

v1 endpoint IDs were name-based hashes: `keccak256(oisTitle, endpointName)`. The ID "CoinGecko/coinPrice" said nothing
about what API was actually called. An operator could change the underlying API without changing the endpoint ID.

v2 endpoint IDs are hashes of the full API specification — the URL, path, method, non-secret parameters, and encoding
rules. The signature over `(endpointId, timestamp, data)` therefore commits to exactly what the airnode was configured
to do.

**Why:** The first-party model — the API provider runs the airnode that serves their own API — means the signature and
the data source are the same party. The endpoint ID turns that configuration into a verifiable commitment: a consumer
contract hard-coding an ID binds itself to the specific URL, parameters, and encoding rules the operator declared. The
operator cannot silently point an endpoint at a different upstream without changing the ID. TLS proofs extend this
further: the endpoint ID can be cross-checked against the proven HTTP request that backs the response.

### Fixed and client-controlled encoding, both committed to by the ID

One upstream API can serve many different consumers. A lending protocol might want ETH/USD as `int256 × 1e18` at
`$.ethereum.usd`; a different consumer might want the same feed as `uint128 × 1e8` at `$.ethereum.usd`; a third might
want the `last_updated_at` timestamp from the same response. Forcing the operator to pre-declare every projection as a
separate endpoint would explode config and require coordination with every downstream consumer before they could
integrate.

v2 resolves this by letting the operator decide **per field** whether to fix a value or leave it client-controlled.
Clients fill unfixed fields via `_type`, `_path`, and `_times` request parameters. Crucially, the endpoint ID commits to
that choice — every field is either a concrete value or the literal `*`:

```
type=int256,path=$.ethereum.usd,times=1e18   # operator fully fixed — all consumers get the same projection
type=int256,path=*,times=1e18                 # operator fixed type and multiplier, consumers pick the JSON path
type=*,path=*,times=*                         # operator lets consumers fully specify encoding
```

The wildcards are in the hash, so any change — narrowing or widening — produces a different endpoint ID. A consumer
contract that hard-codes `keccak256(...|type=int256,path=$.ethereum.usd,times=1e18)` will refuse a signed response where
the operator later widened the endpoint, because the ID no longer matches. A consumer that hard-codes
`keccak256(...|type=int256,path=*,times=1e18)` has knowingly accepted that the submitter chooses the JSON path — they've
signed up for that trust model by picking that specific ID.

**Why not force operators to fully fix encoding?** It would break the shared-infrastructure model. One airnode serves
many downstream use cases; each consumer has a different view of the same response. Forcing every projection into config
turns the operator into a bottleneck for consumer-side design changes.

**Why not leave encoding fully unbound?** Then the signature over `(endpointId, timestamp, data)` would prove only that
_some_ upstream was called — it would carry no guarantee about what the bytes mean. On-chain consumers could not safely
trust signed data without an out-of-band schema. The wildcard-in-hash approach preserves that cryptographic binding
while allowing flexibility; the ID tells consumers exactly how much they're trusting the submitter and how much they're
trusting the operator.

See [Endpoint IDs](/docs/concepts/endpoint-ids) for the full derivation, canonical string format, and consumer-side
verification guidance.

## Signature format

v1 signed `keccak256(requestId, timestamp, airnodeAddress, data)` where the request ID was derived from on-chain state
(sponsor, requester, chain ID, nonce).

v2 signs `keccak256(encodePacked(endpointId, timestamp, data))` where the endpoint ID is derived from the API spec. The
endpoint ID, timestamp, and data are separate top-level fields — not nested inside another hash — so on-chain contracts
and TLS proof verifiers can inspect each field independently.

## TLS proofs for data provenance

v1 had no way to prove that signed data actually came from the claimed upstream API. The EIP-191 signature only proved
_who_ signed — not _where the data came from_. A compromised or dishonest operator could fabricate responses and sign
them.

v2 integrates [TLS proofs](/docs/concepts/proofs) via [Reclaim Protocol](https://reclaimprotocol.org/). When enabled, an
independent attestor participates in the upstream TLS session over MPC-TLS and signs a claim that the response actually
came from the declared HTTPS endpoint and matched the configured `responseMatches` patterns. Airnode attaches the proof
to the response alongside the signature.

```yaml
settings:
  proof:
    type: reclaim
    gatewayUrl: http://localhost:5177/v1/prove

apis:
  - name: CoinGecko
    # ...
    endpoints:
      - name: coinPrice
        # ...
        responseMatches:
          - type: regex
            value: '"usd":\s*(?<price>[\d.]+)'
```

Proof generation is **non-fatal** — if the gateway is unavailable, Airnode still returns the signed response without the
`proof` field and logs a warning. Consumers that require provenance simply reject responses that lack a `proof`.

**Why:** Signatures answer "who endorsed this data." TLS proofs answer "did this data really come from the API." Pairing
them turns an airnode from a trusted relay into a verifiable relay — the operator can no longer forge upstream responses
undetected.

## A real plugin system

v1 had no plugin mechanism — custom behaviour meant forking the node. Every custom auth check, metric, or response
transform bled into a maintenance burden the operator carried alone.

v2 exposes a [plugin system](/docs/plugins) with six hooks that fire at well-defined points in the request pipeline:

| Hook              | Type        | When it fires                          |
| ----------------- | ----------- | -------------------------------------- |
| `onHttpRequest`   | Mutation    | After endpoint resolution, before auth |
| `onBeforeApiCall` | Mutation    | Before the upstream API call           |
| `onAfterApiCall`  | Mutation    | After the upstream API responds        |
| `onBeforeSign`    | Mutation    | After encoding, before signing         |
| `onResponseSent`  | Observation | After the signed response is sent      |
| `onError`         | Observation | When an error occurs at any stage      |

Plugins are ordinary modules loaded from a path in config, with per-request time budgets enforced by the runtime.
Mutation hooks that fail or time out **drop** the request (fail-closed — no data leaks past a broken security plugin);
observation hooks are fire-and-forget.

The pipeline is powerful enough that several v2 capabilities are built as plugins rather than core features:

- **`encrypted-channel`** — ECIES-encrypts responses end-to-end to a requester's ephemeral key
- **`heartbeat`**, **`logger`**, **`slack-alerts`** — operational observability

**Why:** Airnode operators have wildly different needs — custom authorization, bespoke upstream protocols, private
metrics, paid-data gating. A stable hook surface lets those live alongside the core node instead of forking it, and
keeps the core small enough to audit.

## FHE encryption for confidential on-chain data

v1 had no notion of confidential data. Every signed value was public the moment it landed on-chain — visible in calldata
before inclusion (enabling front-running) and readable from storage afterward (making it impossible to sell exclusive
data or keep valuations private).

v2 has [built-in FHE encryption](/docs/concepts/fhe-encryption) built on [Zama's fhEVM](https://docs.zama.ai/fhevm).
Configure the relayer under `settings.fhe`, add an `encrypt` block to an endpoint, and the pipeline encrypts the
ABI-encoded value with the target chain's FHE public key right after encoding — packing the resulting
`(handle, inputProof)` pair as the new `data` field. Airnode signs the ciphertext, so the signature proves the encrypted
data is authentic without ever revealing plaintext.

```
API response → ABI encode → FHE encrypt → sign(ciphertext) → return to client
                                 ↓
                  encrypt with chain's FHE public key
                  pack (handle, inputProof) into data field
```

Because FHE is homomorphic, the callback contract can compute directly on the ciphertext —
`FHE.gt(price, liquidationThreshold)` returns an encrypted boolean without either value ever becoming public. Per-handle
on-chain ACLs determine who is allowed to decrypt.

**Why:** Public oracle data leaks value. Searchers front-run price updates, premium data leaks to non-payers the instant
it's consumed, and confidential valuations can't be delivered at all. FHE lets contracts use oracle data while it stays
encrypted — enabling MEV-protected feeds, paid-data access control, sealed auctions, and confidential RWA pricing on the
same signing and verification path as any other Airnode response. The existing `AirnodeVerifier` contract works
unchanged.

## Response caching

v1 had no response cache. Every request hit the upstream API, which was wasteful for endpoints with long-lived data
(e.g. daily FX rates) and couldn't absorb bursts without rate-limiting the origin.

v2 has an in-memory response cache with configurable TTL, keyed by `(endpointId, sorted parameters)`. Cache config is
set per-API and can be overridden per-endpoint:

```yaml
apis:
  - name: CoinGecko
    cache:
      maxAge: 30000 # 30 seconds
    endpoints:
      - name: coinPrice
        # inherits the 30s cache
      - name: realtimeTicker
        cache:
          maxAge: 1000 # override to 1 second
```

Entries are bounded (10,000 entries by default) and swept on a periodic timer. No external cache server is required.

**Why:** Long-running processes can hold state — caching is free in this model and valuable in practice. Most oracle
endpoints are called far more often than their underlying data changes.

## Other improvements

### Authentication

v1 had on-chain authorization via `RequesterAuthorizerWithAirnode` with role-based access control trees. v2 handles auth
at the HTTP layer with three methods: `free`, `apiKey`, and `x402` (pay-per-request). Multiple methods can be combined
per endpoint (any-of semantics).

### Response modes

v2 endpoints support three modes: `sync` (default request-response), `async` (return 202, poll for result), and `stream`
(Server-Sent Events). v1 only supported synchronous request-response.

### Language and runtime

v1 was a TypeScript monorepo with 10+ packages, Hardhat for testing, and ethers.js for chain interaction. v2 is a single
Bun project with Foundry for contract testing and viem for cryptographic operations. The binary compiles to a standalone
executable with no runtime dependencies.

## What's removed

- Serverless deployment (Lambda, Cloud Functions) and the deployer CLI
- OIS (Oracle Integration Specifications)
- Chain scanning, log fetching, nonce management, gas estimation
- Sponsor wallets and HD wallet derivation
- On-chain request submission, sponsorship management, and authorization
- Allocators, subscription slots, and relayed requests
- AccessControlRegistry and role-based permission trees
- 28+ Solidity contracts
