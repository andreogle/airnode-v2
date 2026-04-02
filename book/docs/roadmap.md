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
- **NFT key auth**: ERC-721 ownership verification via RPC with cached lookups
- **x402 payment**: HTTP 402-based pay-per-request. Client pays on-chain, retries with `X-Payment-Proof` tx hash. Server
  verifies the receipt, checks amount/recipient/recency, prevents replay.
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

## Phase 3: Relayer

Bridge for on-chain request-response without an off-chain client.

A relayer watches for on-chain request events, forwards them to the airnode's HTTP server, and submits the signed
response back on-chain. This restores the request-response flow from Airnode v1 without requiring the airnode itself to
touch the chain.

The relayer is a separate process, not part of the airnode. Anyone can run a relayer -- the airnode's HTTP API is the
only interface.

## Phase 4: Proof modes

Reducing trust assumptions with cryptographic proofs.

- **Deterministic replay**: Prove that the response processing (path extraction, type casting, encoding) was applied
  correctly to the raw API response. Uses zkVM (SP1, RISC Zero) to generate a proof that can be verified on-chain.
- **TEE attestation**: Run the airnode in a Trusted Execution Environment (AWS Nitro Enclaves, Intel SGX, AMD SEV-SNP).
  Remote attestation proves the running code matches a specific binary hash. Combined with DNS identity verification,
  this proves both who operates the airnode and what code it runs.
- **TLS proofs**: When TLSNotary matures, generate cryptographic proof that the data came from a specific HTTPS
  endpoint. The endpoint ID is a separate field in the signature so on-chain verifiers can check it against the proven
  HTTP request.

## Phase 5: ChainAPI platform

Developer experience and ecosystem tooling.

- **Config builder**: Visual interface for building Airnode configs from OpenAPI specs. Replaces manual YAML editing.
- **Endpoint directory**: Public registry of available airnode endpoints with documentation, pricing, and availability
  metrics. Endpoint IDs are the common identifier -- operators serving the same API produce the same ID.
- **Operator dashboard**: Request volume, revenue, uptime metrics.

## Future

- **Solana support**: Port AirnodeVerifier to Solana programs. The HTTP server and signature format are chain-agnostic
  -- only the on-chain verification contract needs to be rewritten.
- **TLS proofs at scale**: Full integration when TLSNotary reaches production readiness with acceptable latency
  overhead. Target: proof generation under 2 seconds per API call.
- **VRF as a service**: Verifiable random functions using the airnode's existing key. RFC 9381 ECVRF with on-chain proof
  verification.
