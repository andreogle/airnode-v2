---
slug: /concepts/pull-and-push
sidebar_position: 2
---

# Pull and Push

Airnode serves data through two delivery models from the same server. Both produce signed data in the same format. The
difference is who initiates the API call.

## Pull

Pull is on-demand. A client sends a request, Airnode calls the upstream API, signs the response, and returns it.

### Request

```bash
curl -X POST http://localhost:3000/endpoints/{endpointId} \
  -H "Content-Type: application/json" \
  -d '{"parameters":{"ids":"ethereum","vs_currencies":"usd"}}'
```

### Response (encoded)

When the endpoint has `encoding` configured, the response contains ABI-encoded data:

```json
{
  "airnode": "0xd1e98F3Ac20DA5e4da874723517c914a31b0e857",
  "endpointId": "0xa1b2...endpoint-id-hash",
  "timestamp": 1711234567,
  "data": "0x00000000000000000000000000000000000000000000006c6b935b8bbd400000",
  "signature": "0x1234...65-byte-ecdsa-signature"
}
```

The `data` field is the ABI-encoded value extracted from the API response at the configured `path`, multiplied by
`times` if specified, and encoded as the configured `type` (e.g., `int256`).

### Response (raw)

Endpoints without `encoding` return the full JSON response. The `data` field is replaced by `rawData`, and the signature
covers the keccak256 hash of the JSON:

```json
{
  "airnode": "0xd1e98F3Ac20DA5e4da874723517c914a31b0e857",
  "endpointId": "0xa1b2...endpoint-id-hash",
  "timestamp": 1711234567,
  "rawData": {
    "ethereum": {
      "usd": 3456.78,
      "usd_24h_vol": 12345678901.23
    }
  },
  "signature": "0x1234...65-byte-ecdsa-signature"
}
```

Raw mode is useful when the consumer needs the full JSON structure or when multiple values from the same response are
needed. The signature still proves the data came from this airnode, but the data itself is not ABI-encoded for on-chain
use.

## Push

Push is continuous. Airnode calls APIs on a background interval, signs the results, and stores them in an in-memory
beacon store. Relayers poll the beacon endpoint and submit signed data to on-chain data feed contracts.

### Config

Add `push.interval` to any endpoint with `encoding`:

```yaml
endpoints:
  - name: ethPrice
    path: /simple/price
    parameters:
      - name: ids
        in: query
        fixed: ethereum
      - name: vs_currencies
        in: query
        fixed: usd
    encoding:
      type: int256
      path: $.ethereum.usd
      times: '1e18'
    push:
      interval: 10000 # call API every 10 seconds
```

Push endpoints typically use `fixed` parameters since there is no client to provide them. The push loop starts
automatically when the server boots.

### Reading beacons

Relayers poll the beacon endpoint to get the latest signed data:

```bash
# Get a specific beacon
curl http://localhost:3000/beacons/{beaconId}

# List all available beacons
curl http://localhost:3000/beacons
```

The response includes the beacon ID alongside the standard signed data:

```json
{
  "airnode": "0xd1e98F3Ac20DA5e4da874723517c914a31b0e857",
  "endpointId": "0xa1b2...endpoint-id-hash",
  "beaconId": "0xc3d4...beacon-id-hash",
  "timestamp": 1711234567,
  "data": "0x00000000000000000000000000000000000000000000006c6b935b8bbd400000",
  "signature": "0x1234...65-byte-ecdsa-signature",
  "delayMs": 60000
}
```

### Beacon IDs

A beacon ID identifies a specific data point from a specific airnode:

```
beaconId = keccak256(encodePacked(airnode, endpointId))
```

Two different airnodes serving the same API endpoint produce different beacon IDs. This is intentional -- the beacon ID
captures both _what_ data is being served and _who_ is serving it. On-chain data feed contracts can aggregate multiple
beacons from different airnodes to produce a more robust price feed.

## Delay

The `cache.delay` field creates a time window between when Airnode receives fresh data and when it serves that data
publicly via the push path. During the delay window, the data exists in the beacon store but is not served to relayers.
This creates an OEV (Oracle Extractable Value) window — privileged consumers can extract value from the price update
before it becomes public on-chain.

```yaml
cache:
  maxAge: 30000 # cache responses for 30 seconds
  delay: 60000 # hold back beacon data by 60 seconds
```

When `delay` is set:

- `GET /beacons/{beaconId}` returns `425 Data not yet available` until the delay window has passed
- `GET /beacons` listing excludes beacons that are still within their delay window
- **Pull requests are not affected** — `POST /endpoints/{id}` always returns fresh data immediately

The delay only applies to the push path (beacon endpoints). Pull requests always call the upstream API and return the
result, regardless of the delay setting.

The delay field is optional. Without it, beacon data is served immediately.

## Response Modes

Pull endpoints support three response modes, configured via `mode` on the endpoint:

**Sync** (default) — standard request-response. The server calls the API, waits for the result, signs it, and responds
in the same HTTP request.

**Async** — for slow APIs (AI inference, human review). The server returns `202 Accepted` immediately with a `requestId`
and `pollUrl`. The API call runs in the background. The client polls `GET /requests/{requestId}` until the status is
`complete` (with signed data) or `failed`.

```yaml
mode: async
```

**Stream** — the signed response is delivered as a Server-Sent Event (SSE). The full pipeline runs (including all plugin
hooks), and the result is sent as a single `data:` event with `Content-Type: text/event-stream`. This is useful for
clients using `EventSource` or SSE-compatible frameworks.

```yaml
mode: stream
```

## When to Use Each

|                  | Pull (sync)                        | Pull (async)                 | Pull (stream)          | Push                        |
| ---------------- | ---------------------------------- | ---------------------------- | ---------------------- | --------------------------- |
| **Initiated by** | Client                             | Client                       | Client                 | Server (background loop)    |
| **Use case**     | On-demand queries, fast APIs       | Slow APIs (AI, human review) | SSE-compatible clients | Continuous data feeds       |
| **Response**     | Immediate signed data              | 202 → poll → signed data     | SSE event              | Stored in beacon store      |
| **Encoding**     | Optional (raw JSON or ABI-encoded) | Optional                     | Optional               | Required (ABI-encoded only) |
| **Parameters**   | Provided by client at request time | Provided by client           | Provided by client     | Fixed in config             |
