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
| `GET`  | `/beacons/{beaconId}`     | Read the latest signed beacon data (push)            |
| `GET`  | `/beacons`                | List all available beacons with their latest values  |
| `GET`  | `/health`                 | Health check returning version and airnode address   |

CORS preflight (`OPTIONS`) is handled automatically. Rate limiting uses a token bucket per client IP, configured via
`server.rateLimit`.

## Request Processing Pipeline

Every `POST /endpoints/{endpointId}` request runs through a 13-step pipeline. Plugin hooks fire at defined points,
giving plugins the ability to observe, filter, or modify data at each stage.

1. **Resolve endpoint** -- look up the endpoint by ID in the endpoint map. Returns 404 if not found.
2. **Plugin: onHttpRequest** -- plugins can reject requests early (IP filtering, custom auth). A rejected request never
   reaches the API.
3. **Authenticate** -- verify client credentials. Either free access (no check) or API key via `X-Api-Key` header,
   matched against the configured key list.
4. **Validate parameters** -- check that all required parameters (those without `fixed` or `default` values) are present
   in the request body.
5. **Check cache** -- if the endpoint has cache config, return a cached response when the TTL has not expired.
6. **Plugin: onBeforeApiCall** -- plugins can modify request parameters before the upstream call.
7. **Call API** -- make the HTTP request to the upstream API via `src/api/call.ts`. Method, path, headers, query
   parameters, and body are assembled from the endpoint config and client parameters.
8. **Plugin: onAfterApiCall** -- plugins can modify the API response before encoding.
9. **Encode** -- if the endpoint has `encoding` configured, extract the value at `path` from the JSON response and
   ABI-encode it as `type` with optional `times` multiplier. Endpoints without encoding return raw JSON.
10. **Plugin: onBeforeSign** -- plugins can modify the encoded data before signing.
11. **Sign** -- EIP-191 personal sign over `keccak256(encodePacked(endpointId, timestamp, data))`. The signature proves
    the data came from this airnode at this time for this endpoint.
12. **Cache** -- store the response if cache config is present. The `maxAge` field controls TTL.
13. **Plugin: onResponseSent** -- observation hook for logging, monitoring, or heartbeats. Cannot modify the response.

Error hooks (`onError`) fire when any stage fails, providing plugins with error context for alerting.

## Pull Flow

Pull is the on-demand path. A client requests data, Airnode calls the API and responds.

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
  │                         ├── Sign (EIP-191)          │
  │                         │                           │
  │◀────── signed response ─│                           │
  │                         │                           │
```

The response is self-contained: it includes the airnode address, endpoint ID, timestamp, encoded data, and signature. A
client can verify the signature locally or submit it to an on-chain contract.

## Push Flow

Push is the continuous path. Airnode calls APIs on a background interval, signs the data, and stores it in an in-memory
beacon store. Relayers poll the beacon endpoints and submit signed data on-chain.

```
                          Airnode                   Upstream API
                            │                           │
                            │  (every N ms per endpoint) │
                            │  HTTP GET/POST             │
                            │───────────────────────────▶│
                            │                            │
                            │◀──────── JSON response ────│
                            │                            │
                            ├── Encode (ABI)             │
                            ├── Sign (EIP-191)           │
                            ├── Store in beacon store    │
                            │                            │

Relayer                   Airnode
  │                         │
  │  GET /beacons/{id}      │
  │────────────────────────▶│
  │                         │
  │◀── signed beacon data ──│
  │                         │
  │  Submit to on-chain     │
  │  data feed contract     │
```

Push endpoints require `encoding` (raw JSON cannot be submitted on-chain) and a `push.interval` field in the config. The
beacon ID is derived from `keccak256(airnode, endpointId)`, so different airnodes serving the same endpoint produce
different beacons.

## Signature Format

All responses are signed with the same scheme:

```
hash = keccak256(encodePacked(endpointId, timestamp, data))
signature = EIP-191 personal sign over hash
```

The three fields (`endpointId`, `timestamp`, `data`) are packed separately -- not nested in another hash. This enables
on-chain contracts to inspect each field independently for freshness checks and TLS proof verification.

For raw (unencoded) responses, `data` is the keccak256 hash of the JSON-serialized response. The full JSON is returned
in the `rawData` field alongside the signature over its hash.

## Startup

When Airnode starts:

1. Load and validate `config.yaml` against the Zod schema.
2. Interpolate environment variables (`${VAR}` references in the config).
3. Derive the airnode address from `AIRNODE_PRIVATE_KEY`.
4. Build the endpoint map: compute each endpoint ID and register it.
5. Load plugins from their `source` paths.
6. Start the push loop for endpoints with `push.interval`.
7. Start the HTTP server on the configured port and host.

The server logs all registered endpoint IDs, beacon IDs (for push endpoints), and the airnode address on startup.
