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
```

## Fields

| Field                         | Type       | Required | Default     | Description                                                                                         |
| ----------------------------- | ---------- | -------- | ----------- | --------------------------------------------------------------------------------------------------- |
| `port`                        | `number`   | Yes      | --          | TCP port the server listens on.                                                                     |
| `host`                        | `string`   | No       | `'0.0.0.0'` | Bind address. Use `127.0.0.1` to restrict to localhost.                                             |
| `cors`                        | `object`   | No       | --          | CORS configuration. When omitted, `Access-Control-Allow-Origin: *` is used.                         |
| `cors.origins`                | `string[]` | No       | `['*']`     | Allowed origins. Each entry is joined with `, ` in the response header.                             |
| `rateLimit`                   | `object`   | No       | --          | Per-IP rate limiting. When omitted, no rate limiting is applied.                                    |
| `rateLimit.window`            | `number`   | Yes      | --          | Time window in milliseconds.                                                                        |
| `rateLimit.max`               | `number`   | Yes      | --          | Maximum requests per IP within the window.                                                          |
| `rateLimit.trustForwardedFor` | `boolean`  | No       | `false`     | Use the first `X-Forwarded-For` entry as the client IP. Only enable behind a trusted reverse proxy. |

## Minimal

The only required field is `port`:

```yaml
server:
  port: 3000
```

This binds to `0.0.0.0:3000` with no rate limiting and a default `Access-Control-Allow-Origin: *` header.

## Rate limiting

Rate limiting uses a token bucket algorithm per IP address. Tokens refill continuously over the window rather than
resetting at fixed intervals.

```yaml
server:
  port: 3000
  rateLimit:
    window: 60000 # 60 seconds
    max: 100 # 100 requests per 60s per IP
```

When a client exceeds the limit, the server returns `429 Too Many Requests`.

The rate limiter tracks up to 10,000 unique IPs. When this limit is reached, the oldest entries are evicted.

By default the client IP is the socket peer. If Airnode runs behind a reverse proxy that is the proxy's address, so
every client would share one bucket — set `rateLimit.trustForwardedFor: true` to use the first `X-Forwarded-For` entry
instead. Only enable this when a trusted proxy controls that header; a client-supplied `X-Forwarded-For` is otherwise
trivially spoofable.

## CORS

CORS headers are included on every response. The `OPTIONS` preflight handler returns:

- `Access-Control-Allow-Origin` -- from `cors.origins`
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

To disable CORS restrictions (allow all origins), omit the `cors` field or set `origins: ['*']`.
