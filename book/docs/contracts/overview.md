---
slug: /contracts/overview
sidebar_position: 1
---

# Contracts Overview

Two contracts. One verifies signed data and forwards it to a callback (pull). The other stores signed data feeds
on-chain for contracts to read (push). Both are Vyper 0.4+, targeting the **prague** EVM version.

| Contract                       | Purpose                                               | Use case               |
| ------------------------------ | ----------------------------------------------------- | ---------------------- |
| [AirnodeVerifier](./verifier)  | Verify signature, prevent replay, forward to callback | One-shot data delivery |
| [AirnodeDataFeed](./data-feed) | Verify signature, store latest value, serve reads     | Continuous data feeds  |

## Architecture

Airnode is an HTTP server. It calls upstream APIs, signs the responses, and returns them to clients. The airnode never
touches the chain. These contracts let clients bring signed data on-chain.

```
Client --> HTTP request --> Airnode --> upstream API --> sign response --> HTTP response
                                                                             |
                                    +----------------------------------------+
                                    |
                              +-----+-----+
                              | On-chain  |
           +------------------+           +------------------+
           |                  +-----------+                  |
    Pull (one-shot)                                   Push (data feed)
           |                                                 |
  AirnodeVerifier                                   AirnodeDataFeed
  verify -> forward                                 verify -> store
  to callback                                       -> read latest
```

## Signature format

Both contracts verify the same signature:

```
message_hash = keccak256(encodePacked(endpoint_id, timestamp, data))
signature = EIP-191 personal sign over message_hash
```

The fields:

- **endpoint_id** -- a specification-bound hash committing to the API URL, path, method, parameters, and encoding rules.
  Two independent airnodes serving the same API with the same config produce the same endpoint ID.
- **timestamp** -- unix timestamp (seconds) of when the data was produced.
- **data** -- ABI-encoded response. For data feeds, this is a single `int256` in 32 bytes. For the verifier, it can be
  arbitrary bytes up to 4096 bytes.

## Design decisions

### No admin, no registry

Both contracts are fully permissionless. There are no owner roles, no access control, no configuration functions. Anyone
can submit valid signed data. The consumer contract decides which airnode addresses to trust.

### Vyper over Solidity

- No inheritance -- flatter, more auditable code
- Built-in reentrancy protection (contract-wide lock in Vyper 0.4+)
- No function overloading or implicit conversions
- Bounded loops and explicit bounds on all dynamic types

### Flat architecture

Two standalone contracts with no shared state, no inheritance chain, and no dependencies on each other. Each can be
deployed and used independently.
