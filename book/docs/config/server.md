---
slug: /config/server
sidebar_position: 2
---

# Server

The `server` section configures the HTTP server that receives client requests.

```yaml
server:
  port: 3000
  host: '0.0.0.0' # default
  cors:
    origins: ['*'] # default
  rateLimit:
    window: 60000 # ms
    max: 100 # requests per window per IP
    x402:
      window: 60000 # ms
      max: 30 # x402 verification attempts per window per IP
```

## Fields

| Field                         | Type       | Required | Default     | Description                                                                                                                |
| ----------------------------- | ---------- | -------- | ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| `port`                        | `number`   | Yes      | --          | TCP port the server listens on.                                                                                            |
| `host`                        | `string`   | No       | `'0.0.0.0'` | Bind address. Use `127.0.0.1` to restrict to localhost.                                                                    |
| `cors`                        | `object`   | No       | --          | CORS configuration. When omitted, `Access-Control-Allow-Origin: *` is used.                                                |
| `cors.origins`                | `string[]` | No       | `['*']`     | Allow-list of origins. The request's `Origin` is reflected back only if it matches an entry.                               |
| `rateLimit`                   | `object`   | **Yes**  | --          | Per-IP rate limiting (required). Set `max` very high to effectively disable it.                                            |
| `rateLimit.window`            | `number`   | Yes      | --          | Time window in milliseconds.                                                                                               |
| `rateLimit.max`               | `number`   | Yes      | --          | Maximum requests per IP within the window.                                                                                 |
| `rateLimit.trustForwardedFor` | `boolean`  | No       | `false`     | Use the first `X-Forwarded-For` entry as the client IP. Only enable behind a trusted reverse proxy.                        |
| `rateLimit.x402`              | `object`   | **Yes**  | --          | Stricter per-IP bucket on x402 verification attempts (each one fires several chain-RPC reads). Shares `trustForwardedFor`. |
| `rateLimit.x402.window`       | `number`   | Yes      | --          | Time window in milliseconds.                                                                                               |
| `rateLimit.x402.max`          | `number`   | Yes      | --          | Maximum x402 verification attempts per IP within the window.                                                               |

## Minimal

`port` and `rateLimit` (including the `x402` sub-block) are required:

```yaml
server:
  port: 3000
  rateLimit:
    window: 60000
    max: 100
    x402:
      window: 60000
      max: 30
```

This binds to `0.0.0.0:3000` with a default `Access-Control-Allow-Origin: *` header. If you front the airnode with your
own WAF/CDN and want that to be the limiter, set `rateLimit.max` to a very large number.

## Rate limiting

Rate limiting uses a token bucket algorithm per IP address. Tokens refill continuously over the window rather than
resetting at fixed intervals.

```yaml
server:
  port: 3000
  rateLimit:
    window: 60000 # 60 seconds
    max: 100 # 100 requests per 60s per IP
    x402:
      window: 60000
      max: 30 # 30 x402 verification attempts per 60s per IP
```

When a client exceeds the limit, the server returns `429 Too Many Requests`.

The rate limiter tracks up to 10,000 unique IPs. When this limit is reached, the oldest entries are evicted.

By default the client IP is the socket peer. If Airnode runs behind a reverse proxy that is the proxy's address, so
every client would share one bucket — set `rateLimit.trustForwardedFor: true` to use the first `X-Forwarded-For` entry
instead. Only enable this when a trusted proxy controls that header; a client-supplied `X-Forwarded-For` is otherwise
trivially spoofable.

### x402 verification bucket

`rateLimit.x402` is a separate, stricter per-IP bucket that applies only to **submitted x402 payment proofs**. Each
verification fires several chain-RPC reads, so an unauthenticated flooder would otherwise drain the operator's RPC quota
even at a generous global `rateLimit.max`. The 402-challenge response (sent when no proof header is present) does not
draw from this bucket. The same client-IP key is used as the global limit, so `trustForwardedFor` applies consistently
to both. When exceeded, the response is `401 Too many x402 verification attempts — slow down`.

## CORS

CORS headers are included on every response (and on the `OPTIONS` preflight, which returns `204`):

- `Access-Control-Allow-Origin`:
  - **No `cors` configured (or `origins: ['*']`)** -- `*`.
  - **`cors.origins` is an allow-list** -- the request's `Origin` header is reflected back **only if it matches** an
    entry on the list (plus `Vary: Origin`). A non-matching or absent `Origin` gets `Access-Control-Allow-Origin: null`.
    Multiple origins are never concatenated into one header — that is invalid and browsers reject it.
- `Access-Control-Allow-Methods` -- `GET, POST, OPTIONS`
- `Access-Control-Allow-Headers` -- `Content-Type, X-Api-Key, Authorization, X-Payment-Proof`
- `Access-Control-Max-Age` -- `86400` (24 hours)

```yaml
server:
  port: 3000
  cors:
    origins:
      - 'https://app.example.com'
      - 'https://staging.example.com'
```

To allow any origin, omit the `cors` field or set `origins: ['*']`.
