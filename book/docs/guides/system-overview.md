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
┌─────────┐  POST /endpoints  ┌──────────────┐  GET /beacons  ┌──────────────┐
│  Client  │ ───────────────▶ │   Airnode     │ ◀──────────── │   Relayer    │
│  (pull)  │ ◀─── signed ─── │              │ ─── signed ──▶ │              │
└─────────┘    response       └──────────────┘    beacon      └──────┬───────┘
                                     │                               │
                                     │ (optional)                    │
                                     ▼                               ▼
                              ┌──────────────┐              ┌──────────────┐
                              │ Cache Server │              │  On-chain    │
                              │              │              │  Contract    │
                              └──────────────┘              └──────────────┘
```

The left side is the **pull path** (on-demand). The right side is the **push path** (continuous feeds).

## Components

**Airnode** -- the core HTTP server. Receives requests, calls upstream APIs, signs responses with the operator's private
key. Stateless. Runs anywhere Bun runs.

**Cache Server** -- an optional intermediary that aggregates signed data from multiple airnodes. Stores the latest
signed responses so clients and relayers do not need direct access to each airnode. Useful in multi-operator setups.

**Relayer** -- reads signed beacon data from an airnode or cache server and submits it on-chain at a configured cadence.
Pays gas. Not part of the airnode itself -- it is a separate service.

**AirnodeVerifier** (contract) -- on-chain signature verification for the pull path. Recovers the signer, checks replay
protection, and forwards data to a callback contract. See [Verifier](/docs/contracts/verifier).

**AirnodeDataFeed** (contract) -- on-chain storage for the push path. Stores `(int224, uint32)` beacon values. Anyone
can submit signed data. Contracts read the latest value at any time. See [Data Feed](/docs/contracts/data-feed).

## Pull flow

1. Client sends `POST /endpoints/{endpointId}` with parameters to the airnode.
2. Airnode authenticates the request (API key, free, or other configured method).
3. Airnode calls the upstream API with the assembled HTTP request.
4. Airnode encodes the response (ABI encoding or raw JSON) and signs it with EIP-191.
5. Client receives the signed response containing `airnode`, `endpointId`, `timestamp`, `data`, and `signature`.
6. Client verifies the signature off-chain by recovering the signer address.
7. (Optional) Client submits the signed data to `AirnodeVerifier.verify_and_fulfill()` on-chain.
8. AirnodeVerifier recovers the signer, enforces replay protection, and calls the consumer contract's callback.

## Push flow

1. Airnode's push loop fires at the configured `push.interval` for each push endpoint.
2. Airnode calls the upstream API and ABI-encodes the response.
3. Airnode signs the encoded data and stores it in the in-memory beacon store.
4. A relayer polls `GET /beacons/{beaconId}` to fetch the latest signed beacon.
5. The relayer submits the signed data to `AirnodeDataFeed.update_beacon()` on-chain.
6. AirnodeDataFeed verifies the signature, checks timestamp freshness, and stores the value.
7. Consumer contracts call `read_beacon(beaconId)` to get the latest `(int224 value, uint32 timestamp)`.

## Single-operator setup

The simplest deployment: one airnode serving data directly to clients.

```
Client ──▶ Airnode ──▶ Upstream API
```

This is enough when:

- One API provider operates one airnode.
- Clients connect directly to the airnode (no aggregation needed).
- You only use the pull path, or run your own relayer for push.

No cache server or external infrastructure required. The airnode is the entire backend.

## Multi-operator setup

Multiple independent airnodes serve the same API data. A cache server aggregates their signed responses. Relayers read
from the cache server and submit on-chain with quorum verification.

```
Airnode A ──┐
Airnode B ──┼──▶ Cache Server ──▶ Relayer ──▶ On-chain Contract
Airnode C ──┘
```

Use this when:

- You need redundancy across independent operators.
- On-chain consumers require data signed by multiple sources (beacon sets / quorum).
- You want to decouple airnode operators from gas payment and on-chain submission.

Each airnode produces its own beacon ID for the same endpoint. The cache server collects all of them. A relayer can
aggregate them into a beacon set on-chain using median aggregation.
