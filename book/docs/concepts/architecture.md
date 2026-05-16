---
slug: /concepts/architecture
sidebar_position: 1
---

# Architecture

Airnode is an HTTP server built on `Bun.serve`. It receives client requests, calls upstream APIs, signs the responses,
and returns the signed data. There is no chain scanning, no coordinator cycle, and no persistent state. The server
starts, loads the config, and serves requests.

## Routes

| Method | Path                      | Description                                          |
| ------ | ------------------------- | ---------------------------------------------------- |
| `POST` | `/endpoints/{endpointId}` | Call an endpoint with parameters in the request body |
| `GET`  | `/requests/{requestId}`   | Poll an async request for its result                 |
| `GET`  | `/health`                 | Health check (status + airnode address)              |

CORS preflight (`OPTIONS`) is handled automatically. Rate limiting uses a token bucket per client IP, configured via
`server.rateLimit`.

## Request Processing Pipeline

Every `POST /endpoints/{endpointId}` request runs through a 15-step pipeline. Plugin hooks fire at defined points,
giving plugins the ability to observe, filter, or modify data at each stage.

1. **Resolve endpoint** -- look up the endpoint by ID in the endpoint map. Returns 404 if not found.
2. **Plugin: onHttpRequest** -- plugins can reject requests early (IP filtering, custom auth). A rejected request never
   reaches the API.
3. **Authenticate** -- verify client credentials based on the configured method: free access (no check), API key via
   `X-Api-Key` header, or x402 payment proof (an `X-Payment-Proof` header attesting a confirmed on-chain payment). An
   unpaid x402 request gets `402` with the payment parameters.
4. **Validate parameters** -- check that all required parameters (those without `fixed` or `default` values) are present
   in the request body. (Async-mode endpoints stop here and return `202` + a `pollUrl`; the rest of the pipeline runs in
   the background.)
5. **Check cache** -- if the endpoint has cache config, return a cached response when the TTL has not expired (sync mode
   only).
6. **Plugin: onBeforeApiCall** -- plugins can modify request parameters before the upstream call.
7. **Call API** -- make the HTTP request to the upstream API via `src/api/call.ts`. Method, path, headers, query
   parameters, and body are assembled from the endpoint config and client parameters.
8. **Plugin: onAfterApiCall** -- plugins can modify the API response before encoding.
9. **Encode** -- if the endpoint has `encoding` configured, extract the value at `path` from the JSON response and
   ABI-encode it as `type` with optional `times` multiplier. Endpoints without encoding return raw JSON.
10. **FHE encrypt** -- if the endpoint has `encrypt` configured, replace the ABI-encoded integer with an FHE ciphertext:
    `abi.encode(bytes32 handle, bytes inputProof)`, produced via the relayer in `settings.fhe`. See
    [FHE Encryption](/docs/concepts/fhe-encryption).
11. **Plugin: onBeforeSign** -- plugins can modify the encoded (or, for `encrypt` endpoints, encrypted) data before
    signing.
12. **Sign** -- EIP-191 personal sign over `keccak256(encodePacked(endpointId, timestamp, data))`. The signature proves
    the data came from this airnode at this time for this endpoint.
13. **TLS proof** -- if proof is enabled in settings and the endpoint has `responseMatches`, request a TLS proof from
    the proof gateway. Proof failures are non-fatal -- the response is returned without a proof. See
    [TLS Proofs](/docs/concepts/proofs).
14. **Cache** -- store the response if cache config is present (sync mode only). The `maxAge` field controls TTL.
15. **Plugin: onResponseSent** -- observation hook for logging, monitoring, or heartbeats. Cannot modify the response.

In `stream` mode the signed result of this pipeline is wrapped in a single Server-Sent Events frame instead of a plain
JSON body. Error hooks (`onError`) fire when any stage fails, providing plugins with error context for alerting.

## Request Flow

A client requests data, Airnode calls the API and responds.

```
Client                    Airnode                   Upstream API
  │                         │                           │
  │  POST /endpoints/{id}   │                           │
  │  { parameters: {...} }  │                           │
  │────────────────────────▶│                           │
  │                         │  HTTP GET/POST            │
  │                         │──────────────────────────▶│
  │                         │                           │
  │                         │◀─────── JSON response ────│
  │                         │                           │
  │                         ├── Encode (ABI or raw)     │
  │                         ├── FHE encrypt (optional)  │
  │                         ├── Sign (EIP-191)          │
  │                         ├── TLS proof (optional)    │
  │                         │                           │
  │◀────── signed response ─│                           │
  │                         │                           │
```

The response is self-contained: it includes the airnode address, endpoint ID, timestamp, encoded data, and signature. A
client can verify the signature locally or submit it to an on-chain contract.

## Signature Format

All responses are signed with the same EIP-191 scheme over `keccak256(encodePacked(endpointId, timestamp, data))`. For
raw (unencoded) responses, `data` is the keccak256 hash of the stable-stringified JSON. See
[Signing and Verification](/docs/concepts/signing) for the full format, off-chain verification code, and the
raw-response hashing rules.

## Startup

When Airnode starts:

1. Load and validate `config.yaml` against the Zod schema.
2. Interpolate environment variables (`${VAR}` references in the config).
3. Derive the airnode address from `AIRNODE_PRIVATE_KEY` or `AIRNODE_MNEMONIC`.
4. Build the endpoint map: compute each endpoint ID and register it.
5. Load plugins from their `source` paths.
6. Start the HTTP server on the configured port and host.

The server logs all registered endpoint IDs and the airnode address on startup.
