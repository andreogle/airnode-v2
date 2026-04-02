---
slug: /concepts/request-response
sidebar_position: 2
---

# Request-Response

Airnode serves data on demand. A client sends a request, Airnode calls the upstream API, signs the response, and returns
it.

## Request

```bash
curl -X POST http://localhost:3000/endpoints/{endpointId} \
  -H "Content-Type: application/json" \
  -d '{"parameters":{"ids":"ethereum","vs_currencies":"usd"}}'
```

## Response (encoded)

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

## Response (raw)

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

## Response (empty)

When the upstream API returns an empty body (e.g. HTTP 204 No Content), the behavior depends on encoding:

- **Raw endpoints** return `rawData: null` with a valid signature, attesting that the API returned no content.
- **Encoded endpoints** return HTTP 502 because there is no data to extract and encode.

```json
{
  "airnode": "0xd1e98F3Ac20DA5e4da874723517c914a31b0e857",
  "endpointId": "0xa1b2...endpoint-id-hash",
  "timestamp": 1711234567,
  "rawData": null,
  "signature": "0x1234...65-byte-ecdsa-signature"
}
```

## Response Modes

Endpoints support three response modes, configured via `mode` on the endpoint:

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

|                  | Sync (default)                     | Async                        | Stream                 |
| ---------------- | ---------------------------------- | ---------------------------- | ---------------------- |
| **Initiated by** | Client                             | Client                       | Client                 |
| **Use case**     | On-demand queries, fast APIs       | Slow APIs (AI, human review) | SSE-compatible clients |
| **Response**     | Immediate signed data              | 202 → poll → signed data     | SSE event              |
| **Encoding**     | Optional (raw JSON or ABI-encoded) | Optional                     | Optional               |
| **Parameters**   | Provided by client at request time | Provided by client           | Provided by client     |
