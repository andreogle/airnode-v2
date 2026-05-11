---
slug: /roadmap
sidebar_position: 11
---

# Roadmap

This page outlines the phased plan for Airnode v2. Each phase builds on the previous and can be delivered independently.
Nothing here is a guarantee -- priorities may shift based on ecosystem needs.

## Phase 1: HTTP server

The foundation. Airnode is a stateless HTTP server that calls upstream APIs, signs responses, and returns them to
clients.

**Delivered:**

- HTTP server with `POST /endpoints/{endpointId}` and `GET /health`
- EIP-191 signed responses (ABI-encoded or raw JSON)
- Specification-bound endpoint IDs (hash of API URL, path, method, parameters, encoding)
- Plugin system with 6 hooks and per-request time budgets
- AirnodeVerifier contract (verify signature, prevent replay, forward to callback)
- DNS identity verification (ERC-7529)
- In-memory response cache with TTL
- CLI for server management, config validation, key generation

## Phase 2: Auth, payment, and streaming

Monetization, access control, and real-time data delivery.

**Delivered:**

- **Multi-method auth**: endpoints accept one or more auth methods (any-of semantics)
- **API key auth**: `X-Api-Key` header with constant-time comparison
- **x402 payment**: HTTP 402-based pay-per-request. The client pays on-chain, signs an authorisation binding the payment
  to the specific airnode, endpoint, and payer, and retries with a JSON-encoded `X-Payment-Proof` header. The server
  verifies the signature, checks the on-chain receipt, and refuses proofs older than the configured lifetime. Mempool
  observers cannot steal the call, and signatures cannot be reused across endpoints, airnodes, or after expiry.
- **Async requests**: endpoints with `mode: async` return 202 immediately. Client polls `GET /requests/{requestId}`
  until complete or failed. Background processing with admission limits.
- **SSE streaming**: endpoints with `mode: stream` return signed data as a Server-Sent Event. Full plugin pipeline runs
  before the SSE event is emitted. The current implementation sends a single signed event and closes the connection --
  functionally equivalent to a sync response, but using SSE framing (`text/event-stream`) so clients can connect with
  the browser `EventSource` API. This establishes the transport protocol for future real-time streaming (see below).

### Future: real-time SSE streaming

The current `mode: stream` sends one event per connection. The next iteration holds the connection open and pushes
multiple signed events as the upstream data changes:

- **Continuous signed updates**: the airnode re-queries the upstream API on an interval (or in response to upstream
  changes) and pushes each new signed result as an SSE event. Each event runs through the full plugin pipeline and
  carries its own EIP-191 signature.
- **Upstream proxy streaming**: if the upstream API itself supports streaming (chunked transfer encoding, SSE, or
  WebSocket), the airnode proxies each chunk -- signing and forwarding incrementally rather than waiting for a complete
  response.
- **EventSource reconnection**: SSE has built-in automatic reconnection. Clients that disconnect and reconnect receive
  the next signed update without any client-side retry logic. The `done: true` field in the event payload distinguishes
  the final event from intermediate updates.
- **Backpressure and flow control**: when the upstream produces data faster than the client consumes it, the server
  buffers or drops stale events (keeping only the latest signed value) to prevent unbounded memory growth.

This turns an endpoint into a real-time signed data stream without changing client code -- existing `EventSource`
clients that work with the single-event implementation will automatically receive continuous updates when the server
upgrades.

## Phase 2.5: Integration-friction fixes

Small, focused additions that directly reduce integration cost for consumers and operators. Each ships independently of
the others.

- **Multi-value encoding**: one API call, one signature, multiple ABI-encoded values in one response (OHLC bundles,
  price plus market cap plus volume, weather readings). Without this, each field requires a separate endpoint making the
  same upstream call.
- **Request batching**: `POST /batch` accepts an array of endpoint requests and returns an array of independently signed
  responses. The batch is a transport optimisation, not a semantic unit. Useful for portfolio trackers, DeFi protocols
  needing multiple prices atomically, and any client fetching N values at once.
- **Signed errors and proof of absence**: the airnode signs upstream errors and empty results, not just successful data.
  Downstream use cases include proving a negative ("the sanctions API confirmed this address has no flags"), verifiable
  SLA reports ("9 signed proofs of failed attempts, upstream was down"), and gap detection in push feeds.
- **MCP server mode**: the airnode exposes its endpoints as Model Context Protocol tools so AI agents discover and call
  them through their native tool-use interface. The signed response is attached as metadata for the agent's principal to
  submit on-chain or verify off-chain. Every airnode endpoint becomes immediately accessible to the AI agent ecosystem
  without custom integration per framework.

## Phase 3: Relayer

Bridge for on-chain request-response without an off-chain client.

A relayer watches for on-chain request events, forwards them to the airnode's HTTP server, and submits the signed
response back on-chain. This restores the request-response flow from Airnode v1 without requiring the airnode itself to
touch the chain.

The relayer is a separate process, not part of the airnode. Anyone can run a relayer -- the airnode's HTTP API is the
only interface.

## Phase 4: Proof and confidentiality modes

Reducing trust assumptions and enabling confidential data flows.

**Delivered:**

- **TLS proofs (Reclaim)**: cryptographic proof that the data came from a specific HTTPS endpoint via MPC-TLS. An
  independent attestor verifies the TLS session and signs a claim. Proofs are non-fatal -- responses are returned
  without proofs if the attestor is unavailable. Configured via `settings.proof` and per-endpoint `responseMatches`. See
  [TLS Proofs](/docs/concepts/proofs).
- **FHE encryption (Zama)**: built-in encryption of the ABI-encoded response before signing, using the target chain's
  FHE public key. Configured via `settings.fhe` plus a per-endpoint `encrypt` block. On-chain contracts compute directly
  on the ciphertext via the Zama coprocessor, with a per-handle ACL controlling decryption. Enables MEV-protected price
  feeds, paid-data access control, and confidential on-chain computation. See
  [FHE Encryption](/docs/concepts/fhe-encryption).
- **Encrypted channel (ECIES)**: plugin that establishes end-to-end encryption between the requester and the airnode.
  Request parameters and signed response bodies are opaque to observers; only the requester's ephemeral key can decrypt.

**Planned:**

- **Deterministic replay (SP1 / RISC Zero)**: a zkVM proof that the response processing pipeline -- path extraction,
  type casting, multiplier math, ABI encoding -- was applied correctly to the raw API response. Both SP1 and RISC Zero
  are production-ready with on-chain verifiers; the target is a proof small enough to verify in a single transaction
  alongside the signature. Combined with TLS proofs, this gives end-to-end verifiability from HTTPS byte to on-chain
  uint256 without trusting the operator's processing.
- **TEE attestation**: run the airnode inside a Trusted Execution Environment (AWS Nitro Enclaves, Intel TDX, AMD
  SEV-SNP). Remote attestation proves the running code matches a specific binary hash. Combined with DNS identity
  verification, this creates a verifiable chain: the domain proves who operates the airnode, the attestation proves what
  code it runs.

## Phase 5: ChainAPI platform

Operator tooling and discoverability for the first-party oracle ecosystem.

- **Endpoint directory**: public registry where API providers publish their airnode endpoints alongside documentation,
  pricing, and availability metrics. Endpoint IDs serve as the stable identifier consumers integrate against.
- **Operator dashboard**: request volume, revenue, uptime, and plugin budget metrics for airnode operators.

## Phase 6: Signing layer for existing APIs

Today, becoming an airnode operator means running a separate process. Many API providers already have production HTTP
servers and would rather add signing to their existing stack than adopt a new one. Phase 6 makes signing a drop-in
capability for any API provider, without changing how they serve HTTP.

All three paths below produce the same signed response format as the standalone airnode, so consumers integrate the same
way regardless of how the provider deployed. The provider holds the signing key throughout.

- **Framework middleware**: a small library for Hono, Express, Fastify, FastAPI, Rails, Phoenix, Go `net/http`, and the
  major serverless runtimes (Lambda, Vercel, Cloudflare Workers). The middleware signs outgoing response bodies with the
  provider's key and optionally enforces `x402` or API-key auth on incoming requests. The response body is never
  modified -- signatures go in HTTP headers, so existing clients are unaffected.
- **API gateway plugins**: drop-in plugins for Kong, AWS API Gateway, and Cloudflare Workers. The provider installs the
  plugin, configures a signing key, and every response passing through the gateway gets signed. No application changes
  required.
- **Reverse proxy / sidecar**: a standalone Docker container that sits in front of an existing API and signs all proxied
  responses. Zero changes to the API server itself, ideal for legacy stacks or providers without access to their
  application code.

This is the biggest adoption lever on the roadmap: it turns "add Airnode to your API" from "deploy and operate a new
service" into "add a dependency."

## Future

- **Chain ports**: `AirnodeVerifier` is the only chain-specific component. The HTTP server and signature format are
  chain-agnostic. Ports to Solana, Sui, Aptos, and non-EVM L1s are primarily contract work, not protocol work, and can
  land independently.
- **VRF as a service**: verifiable random functions using the airnode's existing key. RFC 9381 ECVRF with on-chain proof
  verification, delivered as a new endpoint mode.
