---
slug: /operators/cache-server
sidebar_position: 3
---

# Cache Server

The cache server is a standalone process that receives signed beacon data from one or more airnodes and serves it to
clients. It has no private key, no API credentials, and no business logic — it only stores and serves pre-signed data.

## When to use it

The built-in `/beacons` routes on the airnode are sufficient for single-operator setups. A separate cache server is
useful when:

- **Multiple airnodes** push signed data to a shared read endpoint. Clients query one URL instead of N airnode URLs.
- **Security isolation** — the airnode holds the private key and API credentials. A cache server has neither, reducing
  attack surface for the public-facing read layer.
- **Delay tiers** — serve real-time data to paying clients and delayed data to free-tier clients, using the same signed
  data. The airnode signs once; the cache server enforces delay policies.
- **Independent scaling** — beacon reads don't compete with the airnode's API call and signing workload.

## Architecture

```
Airnode A ──push──→ ┌──────────────┐ ←── GET /realtime/{beaconId} ── Paying client
Airnode B ──push──→ │ Cache Server │ ←── GET /delayed/{beaconId}  ── Free client
Airnode C ──push──→ └──────────────┘
```

Each airnode POSTs signed beacons to the cache server. The cache server verifies signatures on ingestion (recovering the
signer address via EIP-191) and rejects data that doesn't match the claimed airnode address.

## Configuration

The cache server uses a separate config file from the airnode:

```yaml
version: '1.0'

server:
  port: 8090
  host: '0.0.0.0'
  cors:
    origins:
      - '*'
  rateLimit:
    window: 60000
    max: 1000

allowedAirnodes:
  - address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
    authToken: ${CACHE_SERVER_AUTH_TOKEN}

endpoints:
  - path: /realtime
    delaySeconds: 0
    auth:
      type: apiKey
      keys:
        - ${REALTIME_CLIENT_KEY}
  - path: /delayed
    delaySeconds: 60
    auth:
      type: free
```

### `allowedAirnodes`

An explicit list of airnode addresses authorized to push data, each with an auth token for bearer authentication. Every
airnode that pushes to this cache server must be listed — there is no wildcard mode. This ensures only trusted airnodes
can populate the store.

### `endpoints`

Each endpoint defines a read path with a delay and optional auth:

| Field          | Type     | Required | Description                                                |
| -------------- | -------- | -------- | ---------------------------------------------------------- |
| `path`         | `string` | Yes      | URL path prefix (e.g. `/realtime`). Must start with `/`.   |
| `delaySeconds` | `number` | Yes      | Minimum age of data in seconds. `0` for real-time.         |
| `auth`         | `object` | No       | Client-facing auth (same format as airnode endpoint auth). |

The same signed beacon data is served through all endpoints. The delay filter only returns beacons whose timestamp is at
least `delaySeconds` old.

## Running

```bash
airnode cache-server -c cache-server.yaml -e .env
```

| Option            | Alias | Default             | Description                  |
| ----------------- | ----- | ------------------- | ---------------------------- |
| `--config <path>` | `-c`  | `cache-server.yaml` | Path to the config file      |
| `--env <path>`    | `-e`  | `.env`              | Path to the environment file |

No `AIRNODE_PRIVATE_KEY` is needed — the cache server only verifies signatures, it does not sign.

## API routes

### `POST /beacons/{airnodeAddress}`

Ingest signed beacon data. Requires `Authorization: Bearer <token>` matching the `authToken` for the airnode address in
`allowedAirnodes`.

**Request body** — a single beacon or an array of beacons:

```json
{
  "airnode": "0x...",
  "endpointId": "0x...",
  "beaconId": "0x...",
  "timestamp": 1711234567,
  "data": "0x...",
  "signature": "0x..."
}
```

**Response:**

```json
{ "count": 1, "skipped": 0, "errors": 0 }
```

- `count` — beacons successfully stored (newer than existing)
- `skipped` — beacons with a timestamp equal to or older than the existing value
- `errors` — beacons with invalid signatures or missing fields

### `GET /{endpointPath}/{beaconId}`

Serve a single beacon by ID. Returns 425 if the beacon is newer than the endpoint's `delaySeconds` allows.

### `GET /{endpointPath}`

List all beacons available at this endpoint, filtered by the delay.

### `GET /health`

Health check. Returns `{ "status": "ok", "version": "..." }`.

## Push targets (airnode side)

To push signed data from the airnode to a cache server, add `targets` to the endpoint's `push` configuration:

```yaml
push:
  interval: 10000
  targets:
    - url: http://cache.example.com/beacons/0xYourAirnodeAddress
      authToken: ${CACHE_SERVER_AUTH_TOKEN}
```

| Field       | Type     | Required | Description                                            |
| ----------- | -------- | -------- | ------------------------------------------------------ |
| `url`       | `string` | Yes      | Cache server ingestion URL (includes airnode address). |
| `authToken` | `string` | Yes      | Bearer token matching the cache server's config.       |

Push requests are retried up to 2 times with a 1-second delay on failure. The push is fire-and-forget — failures don't
block the push loop.
