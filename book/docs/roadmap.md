---
slug: /roadmap
sidebar_position: 11
---

# Technical Roadmap

This roadmap covers Airnode v2 as a technical product: protocol integrity, verification, developer experience, operator
reliability, delivery modes, and documentation. Marketplace, provider acquisition, pricing, and other business or
ecosystem work are intentionally tracked separately.

Items are ordered by dependency and risk, not by marketing value. An item is supported only when its implementation,
tests, and documentation are delivered. Planned items are not guarantees.

## Product principles

Future work should preserve these constraints:

- **Receipts before claims**: define exactly what is signed and independently verifiable before adding stronger proof
  language.
- **Explicit trust boundaries**: distinguish provider signatures, intermediary signatures, separate TLS attestations,
  confidential execution, and multi-party agreement.
- **Fail closed for signed success**: malformed requests, ambiguous transformations, and upstream failures must not
  become successful signed data.
- **Versioned compatibility**: protocol changes need explicit versions, test vectors, and migration guidance.
- **Small operational surface**: prefer bounded, inspectable components over a large mandatory network or control plane.
- **Portable verification**: receipts should be verifiable without running an Airnode or trusting its operator.
- **Documentation is part of the protocol**: every security-relevant field and limitation needs normative documentation
  and executable examples.

## Current foundation

### Runtime and delivery

- HTTP server with `POST /endpoints/{endpointId}`, `GET /requests/{requestId}`, and `GET /health`
- Sync and async endpoint modes
- Single-event SSE response mode, which establishes SSE framing but is not yet a continuous stream
- EIP-191 signed responses with ABI encoding or raw JSON
- Multi-value ABI encoding from one upstream response
- Specification-derived endpoint IDs
- In-memory response cache, rate limiting, concurrency limits, and bounded async admission
- Plugin system with six hooks and per-request time budgets

### Access and payment

- API-key and multi-method client authentication
- x402 pay-per-request verification with signer, payer, airnode, endpoint, transaction, and expiry binding
- Upstream headers and fixed parameters with environment interpolation

### Contracts and identity

- `AirnodeVerifier` for signature recovery, replay protection, and callback delivery
- Example public and confidential consumers
- DNS identity verification through ERC-7529

### Proof and confidentiality modes

- Optional Reclaim TLS claims produced from a separate gateway request
- Optional Zama FHE encryption for configured on-chain consumers
- ECIES plugin for requester-to-Airnode encrypted transport

TLS claims add independent evidence about the gateway's HTTPS session and configured response matches. They do not prove
that the separately fetched response is byte-for-byte equal to the payload Airnode signed. See
[TLS Proofs](/docs/concepts/proofs).

## Priority 1: Versioned signed receipts

The current signed tuple is compact, but it does not commit to the complete request invocation. The next protocol
version should define a structured, domain-separated receipt, preferably using EIP-712 or an equivalently explicit
encoding.

A receipt should commit to:

- protocol and endpoint version
- provider and signing key
- endpoint ID
- canonical request-manifest hash
- response-schema hash
- encoded data hash
- issue and expiry times
- request ID or nonce
- optional payment-receipt hash
- optional proof or attestation hash
- optional transformation-manifest hash

The canonical request manifest should cover the resolved method, URL, query parameters, relevant headers, request body,
response selection, and encoding instructions without disclosing configured secrets. This allows a verifier to
distinguish two invocations of the same endpoint specification, such as `asset=ETH` and `asset=BTC`.

Delivery requirements:

1. Publish a normative receipt specification and canonicalization rules.
2. Add fixed cross-language signing and verification vectors.
3. Support both the existing receipt and the new version during migration.
4. Add TypeScript-to-Solidity compatibility tests that exercise the production signing path.
5. Document replay, expiry, privacy, and parameter-disclosure implications.

### Structured failure receipts

Arbitrary upstream error bodies must never be signed as successful endpoint data. A later receipt version may support
failure evidence through a separate, domain-separated envelope containing a stable error code, attempt time, endpoint
ID, and redacted diagnostic metadata. Failure receipts must be impossible to decode or submit as successful data.

## Priority 2: Verification SDKs and normative documentation

Portable verification should be a first-class product surface rather than example code copied from the book.

Planned deliverables:

- TypeScript verification package with receipt, freshness, signer, schema, and proof helpers
- Solidity consumer library with trusted-signer, endpoint, expiry, replay, and decoding guards
- JSON Schema and OpenAPI output for configured endpoints and receipt versions
- generated MCP tool definitions and a server adapter that returns signed receipts as tool metadata
- generated typed clients and response decoders
- CLI commands to inspect, decode, and verify saved receipts
- published positive and negative test vectors for every supported receipt version
- one end-to-end conformance suite shared by the runtime, SDK, and contracts

The book should identify normative protocol pages separately from tutorials and clearly label experimental integrations.

## Priority 3: Provider identity and key lifecycle

A signer address identifies a key, not a durable provider. Production operation needs continuity across key rotation and
incidents.

Planned capabilities:

- provider identity document containing authorized signing keys and endpoint namespaces
- signed key rotation and revocation records
- historical verification after rotation
- separate development, staging, and production authorities
- hardware or remote signing backends without exposing raw keys to the runtime
- CLI workflows for rotation, revocation, backup, and verification
- documented compromise and recovery procedures

The first implementation should remain self-hostable. It should not require a token, staking system, or mandatory global
registry.

## Priority 4: Operator reliability and observability

The runtime should provide enough evidence to operate it safely without requiring a separate platform.

Planned capabilities:

- Prometheus-compatible metrics for requests, upstream calls, latency, proofs, payments, plugins, and queue pressure
- structured health and version output suitable for automated deployment checks
- per-endpoint success, failure, and proof-availability measurements
- configuration dry-run and semantic diff before rollout
- graceful configuration reload where safe, with restart required for key or trust-boundary changes
- optional durable async storage with explicit retention and bounded cleanup
- privacy-aware receipt and audit-log export
- documented backup, recovery, upgrade, and rollback procedures
- verified container images and release artifacts for supported targets

Logs and metrics must not include secrets, raw payment credentials, or unredacted upstream error bodies.

## Priority 5: Delivery modes

### Continuous signed streams

Extend the current single-event SSE mode into a bounded continuous stream:

- each event is a complete independently verifiable receipt
- configurable polling or upstream event source
- event IDs and resumable delivery
- latest-value backpressure rather than unbounded buffering
- heartbeat, disconnect, shutdown, and reconnection semantics
- per-subscriber admission and payment policy

### Request batching

Add a bounded batch transport that returns independently signed receipts. Batching reduces transport overhead but does
not make upstream calls or results atomic. Limits, partial failures, ordering, cancellation, and payment behavior must
be specified before implementation.

### Webhooks and subscriptions

Support signed webhook delivery with retry limits, idempotency keys, expiry, and replay-safe verification. Subscription
state should remain outside the core stateless request pipeline where possible.

### Policy-driven relayer

Keep the relayer as a separate process. It may submit receipts based on freshness, deviation, schedule, proof policy,
gas budget, or explicit on-chain requests. The relayer must not become a new source of truth; contracts continue to
verify the provider receipt.

## Priority 6: Verifiable processing and proof composition

Proof work should build on the structured receipt and request manifest rather than introduce parallel, incompatible
formats.

Planned work:

- bind proof metadata and extracted claims to the signed receipt
- publish explicit proof profiles describing exactly what each mode establishes
- hash and identify deterministic transformation programs
- support reproducible transformations through a restricted runtime or hash-addressed WASM module
- evaluate zkVM proofs only after the transformation format and performance budget are stable
- evaluate TEE attestation only with reproducible builds, key-release policy, and documented hardware trust assumptions
- harden FHE examples with capability checks, lifecycle guidance, and end-to-end compatibility tests
- optionally bundle independent provider attestations without making a decentralized network mandatory

A proof profile must never use a generic `verified` label when it proves only source, execution, confidentiality, or
multi-party agreement.

## Priority 7: Deployment adapters

Reduce adoption friction without creating multiple receipt formats.

Recommended order:

1. **Reverse proxy or sidecar**: sign and optionally charge for responses from an existing API with no application
   changes.
2. **Framework middleware**: begin with one TypeScript runtime and one non-TypeScript reference implementation.
3. **Gateway adapters**: add adapters only where deployment and key-custody semantics can be tested end to end.

Every adapter must emit the same versioned receipt, pass the conformance suite, preserve streaming and error semantics,
and keep the provider's signing key under provider control.

## Longer-term technical options

These remain valid experiments after the core receipt and verification work is mature:

- append-only receipt transparency logs with Merkle inclusion proofs and optional batch anchoring
- Solana, Sui, Aptos, and other verifier ports driven by concrete integrations
- privacy-preserving selective disclosure of request and response fields
- deterministic aggregate receipts over several named first-party providers
- additional payment facilitators and settlement networks behind one payment-receipt interface

## Removed or deferred from the technical roadmap

The previous roadmap mixed protocol work with ecosystem and speculative features. The following are no longer technical
roadmap commitments:

- public endpoint marketplace and provider-directory work, which belongs to the separate business and ecosystem roadmap
- generic operator dashboards tied to a hosted platform, although self-hosted observability remains a technical priority
- token, staking, or mandatory decentralized-operator designs
- OEV products and other application-specific economic mechanisms
- VRF as a service without a concrete consumer and security specification
- signing arbitrary upstream errors as successful data
- broad framework and chain support before the receipt conformance suite exists

## Recommended sequence

1. Versioned signed receipt and canonical request manifest
2. Cross-language conformance suite and verification SDKs
3. Provider identity, rotation, and secure key backends
4. Operator metrics, release evidence, and recovery documentation
5. Continuous streaming, batching, webhooks, and policy relayer
6. Proof composition and verifiable transformations
7. Sidecar, middleware, gateways, and additional chain ports

This sequence keeps the protocol honest and independently verifiable before increasing delivery modes, proof complexity,
or deployment surface.
