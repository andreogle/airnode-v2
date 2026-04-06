---
slug: /roadmap
sidebar_position: 11
---

# Roadmap

This page tracks what Airnode v2 has shipped and where it's heading. Nothing planned is a guarantee — priorities shift
based on ecosystem needs.

## What's shipped

### HTTP server and signed responses

The foundation. Airnode is a stateless HTTP server that calls upstream APIs, signs responses with EIP-191, and returns
them to clients. Clients submit the signed data on-chain themselves.

- `POST /endpoints/{endpointId}` and `GET /health`
- Specification-bound endpoint IDs (hash of API URL, path, method, parameters, encoding)
- ABI-encoded or raw JSON responses
- AirnodeVerifier contract (verify signature, prevent replay, forward to callback)
- DNS identity verification (ERC-7529)
- In-memory response cache with TTL
- CLI for server management, config validation, key generation

### Auth and payment

- **Multi-method auth** per endpoint (any-of semantics): `free`, `apiKey`, `x402`
- **API key auth**: `X-Api-Key` header with constant-time comparison
- **x402 payment**: HTTP 402-based pay-per-request with on-chain payment verification and replay prevention

### Response modes

- **Sync** (default): request-response
- **Async**: returns 202 immediately, client polls `GET /requests/{requestId}` until complete
- **Stream**: signed data as a Server-Sent Event (`text/event-stream`)

### Plugin system

Six hooks (`onHttpRequest`, `onBeforeApiCall`, `onAfterApiCall`, `onBeforeSign`, `onResponseSent`, `onError`) with
per-request time budgets.

### TLS proofs

Cryptographic proof that data came from a specific HTTPS endpoint via MPC-TLS (Reclaim protocol). An independent
attestor verifies the TLS session and signs a claim. Combined with specification-bound endpoint IDs, this eliminates the
trust assumption on the operator — the data is verifiable end-to-end. See [TLS Proofs](/docs/concepts/proofs).

## What's next

### Relayer

A separate process that watches for on-chain request events, forwards them to the airnode's HTTP API, and submits the
signed response back on-chain. This restores the request-response flow from Airnode v1 without requiring the airnode
itself to touch the chain. Anyone can run a relayer.

### Real-time SSE streaming

The current `mode: stream` sends one event per connection. The next iteration holds the connection open and pushes
multiple signed events as the upstream data changes — re-querying on an interval or proxying upstream streams. Each
event carries its own EIP-191 signature.
