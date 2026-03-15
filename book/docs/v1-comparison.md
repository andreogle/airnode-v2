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

## Two contracts instead of thirty

v1 had 30+ Solidity contracts across multiple modules: request-response (AirnodeRrpV1), pub-sub (AirnodePsp),
authorization (RequesterAuthorizerWithAirnode, AccessControlRegistry), sponsor wallets, allocators, subscription slots,
data feeds (Api3ServerV1), OEV auctions, proxies, and more.

v2 has two Vyper contracts:

- **AirnodeVerifier** — pull path. Verifies a signature and forwards data to a callback contract.
- **AirnodeDataFeed** — push path. Stores signed beacon data for contracts to read.

Both are permissionless, stateless (beyond replay/beacon storage), and have no admin functions.

**Why:** Most of v1's contract complexity existed to manage trust between sponsors, requesters, and airnodes on-chain.
With v2's HTTP model, trust is handled at the HTTP layer (API keys, NFT keys, x402 payment). The contracts only need to
verify signatures — everything else is unnecessary.

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
rules. Two independent operators serving the same API with the same config produce the same endpoint ID automatically.

**Why:** Specification-bound IDs enable cross-operator comparability without a registry. A quorum verifier can confirm
that multiple airnodes signed data for the same endpoint ID — meaning they all committed to calling the same API the
same way. When TLS proofs mature, the endpoint ID can be verified against the proven HTTP request on-chain.

## Pull and push from one server

v1 required separate deployments for request-response (RRP) and pub-sub (PSP). They used different contracts, different
trigger configs, and different processing pipelines.

v2 serves both from the same process. Pull requests arrive via `POST /endpoints/{id}`. Push data is produced by a
background loop that calls APIs on a timer and stores signed beacons at `GET /beacons/{id}`. A relayer polls the beacon
endpoints and submits to `AirnodeDataFeed` on-chain.

**Why:** Pull and push are the same operation (call API → sign) with different delivery timing. Splitting them into
separate systems doubled the operational surface for no benefit.

## Signature format

v1 signed `keccak256(requestId, timestamp, airnodeAddress, data)` where the request ID was derived from on-chain state
(sponsor, requester, chain ID, nonce).

v2 signs `keccak256(encodePacked(endpointId, timestamp, data))` where the endpoint ID is derived from the API spec. The
endpoint ID, timestamp, and data are separate top-level fields — not nested inside another hash — so on-chain contracts
and future TLS proof verifiers can inspect each field independently.

## Other improvements

### Authentication

v1 had on-chain authorization via `RequesterAuthorizerWithAirnode` with role-based access control trees. v2 handles auth
at the HTTP layer with four methods: `free`, `apiKey`, `nftKey` (ERC-721 ownership), and `x402` (pay-per-request).
Multiple methods can be combined per endpoint (any-of semantics).

### Response modes

v2 endpoints support three modes: `sync` (default request-response), `async` (return 202, poll for result), and `stream`
(Server-Sent Events). v1 only supported synchronous request-response.

### Plugin system

v2 has a plugin system with six hooks (`onHttpRequest`, `onBeforeApiCall`, `onAfterApiCall`, `onBeforeSign`,
`onResponseSent`, `onError`) and per-request time budgets. v1 had no plugin mechanism — custom logic required forking
the node.

### Caching and OEV

v2 caches responses in memory with configurable TTL. Push beacon data can be delayed via `cache.delay` to create an OEV
window — real-time data is served to authenticated clients while public beacon data is held back.

### Vyper contracts

v2 contracts are written in Vyper 0.4+ instead of Solidity. Vyper has no function overloading, no inheritance surprises,
built-in reentrancy protection, and bounds checking on all array accesses. The test suite includes unit, invariant
(stateful fuzz), and symbolic (Halmos) tests.

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
