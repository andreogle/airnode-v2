---
slug: /guides/system-overview
sidebar_position: 1
---

# System Overview

Airnode connects APIs to blockchains. This page shows how the pieces fit together.

```
                         ┌──────────────┐
                         │  Upstream    │
                         │  API         │
                         └──────┬───────┘
                                │
                                ▼
┌─────────┐  POST /endpoints  ┌──────────────┐
│  Client  │ ───────────────▶ │   Airnode     │
│          │ ◀─── signed ─── │              │
└─────────┘    response       └──────────────┘
```

## Components

**Airnode** -- the core HTTP server. Receives requests, calls upstream APIs, signs responses with the operator's private
key. Stateless. Runs anywhere Bun runs.

**AirnodeVerifier** (contract) -- on-chain signature verification. Recovers the signer, checks replay protection, and
forwards data to a callback contract. See [Verifier](/docs/contracts/verifier).

## Request flow

1. Client sends `POST /endpoints/{endpointId}` with parameters to the airnode.
2. Airnode authenticates the request (API key, free, or other configured method).
3. Airnode calls the upstream API with the assembled HTTP request.
4. Airnode encodes the response (ABI encoding or raw JSON) and signs it with EIP-191.
5. Client receives the signed response containing `airnode`, `endpointId`, `timestamp`, `data`, and `signature`.
6. Client verifies the signature off-chain by recovering the signer address.
7. (Optional) Client submits the signed data to `AirnodeVerifier.verify_and_fulfill()` on-chain.
8. AirnodeVerifier recovers the signer, enforces replay protection, and calls the consumer contract's callback.

## Single-operator setup

The simplest deployment: one airnode serving data directly to clients.

```
Client ──▶ Airnode ──▶ Upstream API
```

This is enough when:

- One API provider operates one airnode.
- Clients connect directly to the airnode (no aggregation needed).

No external infrastructure required. The airnode is the entire backend.

## Multi-operator setup

Multiple independent first-party airnodes — each operated by a different API provider — serve comparable data. Clients
query multiple airnodes and aggregate their signed responses.

```
Airnode A (Provider X) ──┐
Airnode B (Provider Y) ──┼──▶ Client ──▶ On-chain Contract
Airnode C (Provider Z) ──┘
```

Use this when:

- You need redundancy across independent API providers.
- On-chain consumers require data signed by multiple first-party sources (quorum verification).

The trust value of a multi-operator setup comes from **independence at the source level**. Multiple first-party airnodes
from different API providers (e.g., CoinGecko, CoinMarketCap, CryptoCompare each running their own airnode) provide
genuine redundancy — an attacker would need to compromise multiple independent data sources. Multiple third-party
operators calling the same API do not provide this property, since they all depend on the same upstream source and
introduce the same intermediary trust assumptions.
