---
slug: /contracts/overview
sidebar_position: 1
---

# Contracts Overview

One contract that verifies signed data and forwards it to a callback. Solidity, targeting the **prague** EVM version.

| Contract                      | Purpose                                               | Use case               |
| ----------------------------- | ----------------------------------------------------- | ---------------------- |
| [AirnodeVerifier](./verifier) | Verify signature, prevent replay, forward to callback | One-shot data delivery |

## Architecture

Airnode is an HTTP server. It calls upstream APIs, signs the responses, and returns them to clients. The airnode never
touches the chain. This contract lets clients bring signed data on-chain.

```
Client --> HTTP request --> Airnode --> upstream API --> sign response --> HTTP response
                                                                             |
                                    +----------------------------------------+
                                    |
                              +-----+-----+
                              | On-chain  |
                              |           |
                         AirnodeVerifier
                         verify -> forward
                         to callback
```

## Signature format

`AirnodeVerifier` checks an EIP-191 signature over
`keccak256(abi.encodePacked(endpointId, timestamp, data))`. See
[Signing and Verification](/docs/concepts/signing) for the full format and off-chain verification.

The fields it commits to:

- **endpointId** -- a specification-bound hash committing to the API URL, path, method, parameters, and encoding rules.
  Two independent airnodes serving the same API with the same config produce the same endpoint ID.
- **timestamp** -- unix timestamp (seconds) of when the data was produced.
- **data** -- the signed payload: ABI-encoded value, an FHE ciphertext, or `keccak256` of the raw JSON. The contract
  treats it as opaque `bytes` and forwards it to the callback unchanged. (Airnode caps the HTTP _request_ body at 64 KB,
  but the contract imposes no size limit on `data`.)

## Design decisions

### No admin, no registry

The contract is fully permissionless. There are no owner roles, no access control, no configuration functions. Anyone
can submit valid signed data. The consumer contract decides which airnode addresses to trust.

### Minimal Solidity

A single, self-contained Solidity contract with no external dependencies (no OpenZeppelin, no libraries). ECDSA recovery
is implemented inline for auditability and to minimize the attack surface.

### Flat architecture

A standalone contract with no shared state, no inheritance chain, and no external dependencies. It can be deployed and
used independently.
