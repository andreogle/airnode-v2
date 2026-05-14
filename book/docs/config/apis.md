---
slug: /config/apis
sidebar_position: 4
---

# APIs and Endpoints

The `apis` section defines the upstream APIs that Airnode calls and how their responses are processed.

```yaml
apis:
  - name: CoinGecko
    url: https://api.coingecko.com/api/v3
    timeout: 15000
    headers:
      x-cg-pro-api-key: ${COINGECKO_API_KEY}
    auth:
      type: apiKey
      keys:
        - ${CLIENT_API_KEY}
    cache:
      maxAge: 30000
    endpoints:
      - name: coinPrice
        path: /simple/price
        # ...
```

## API-level fields

| Field       | Type                     | Required | Default | Description                                                         |
| ----------- | ------------------------ | -------- | ------- | ------------------------------------------------------------------- |
| `name`      | `string`                 | Yes      | --      | Human-readable name for this API.                                   |
| `url`       | `string` (URL)           | Yes      | --      | Upstream API base URL. Must be a valid URL.                         |
| `headers`   | `Record<string, string>` | No       | --      | Headers sent with every upstream request. Use `${VAR}` for secrets. |
| `auth`      | `object`                 | No       | --      | Client-facing authentication. See [Auth](#auth).                    |
| `cache`     | `object`                 | No       | --      | Response caching. See [Cache](#cache).                              |
| `timeout`   | `number`                 | No       | `10000` | Upstream request timeout in milliseconds.                           |
| `endpoints` | `array`                  | Yes      | --      | One or more endpoint definitions. Minimum 1.                        |

### `headers`

Static headers sent with every upstream API request. Use environment variable interpolation for credentials:

```yaml
headers:
  x-cg-pro-api-key: ${COINGECKO_API_KEY}
  Accept: application/json
```

These are upstream credentials -- they authenticate Airnode to the API provider. This is separate from `auth`, which
controls who can call Airnode.

## Auth

The `auth` field controls client-facing authentication -- who is allowed to call your Airnode endpoints. It can be set
at the API level (applies to all endpoints) or overridden per endpoint.

### Free access

Anyone can call the endpoint without credentials:

```yaml
auth:
  type: free
```

### API key

Clients must send a valid key in the `X-Api-Key` header:

```yaml
auth:
  type: apiKey
  keys:
    - ${CLIENT_API_KEY}
    - ${CLIENT_API_KEY_2}
```

Keys are checked against the `X-Api-Key` request header using constant-time comparison. Multiple keys are supported for
key rotation.

### x402 (HTTP-native payment)

Pay-per-request using on-chain transfers. When a client requests without payment, the server returns a 402.

This is an x402-_flavoured_ scheme — it borrows the HTTP 402 pay-per-request idea but is **not** the x402 wire protocol:
clients pay on-chain first and then prove the confirmed transaction, rather than handing over a signed EIP-3009
authorization in an `X-PAYMENT` header.

```yaml
auth:
  type: x402
  network: 8453 # chain ID for payment
  rpc: https://mainnet.base.org
  token: '0xA0b8...' # ERC-20 address (or 0x000...0 for ETH)
  amount: '1000000' # token base units, integer string (e.g. 1 USDC = 1000000)
  recipient: '0x...' # operator's address
  expiry: 300000 # payment window in ms (default 5 min)
```

Flow: client POSTs → gets `402` with payment details (`airnode`, `endpointId`, `amount`, `token`, `network`,
`recipient`, `expiresAt`) → sends the on-chain transfer → signs
`keccak256(encodePacked(airnode, endpointId, uint64(expiresAt)))` with the payer's EOA → retries with
`X-Payment-Proof: <json>` where the JSON is `{ "txHash": "0x…", "expiresAt": <unix-seconds>, "signature": "0x…" }`.

The server checks that the signature recovers to the transaction's sender, that the proof has not expired, and that the
transaction matches the configured amount and recipient. The signature binds the payment to a specific airnode and
endpoint (so it can't be replayed elsewhere) and to a short `expiresAt` window. Each `txHash` is the per-payment
uniqueness key — it can be redeemed exactly once.

`expiresAt` must be a future unix-seconds timestamp no further ahead than 10 minutes; longer-lived proofs are rejected.

Submitted proofs are additionally rate-limited **per client IP** before the airnode touches the chain RPC — currently 30
attempts per minute per IP. The unpaid 402 challenge path is unaffected. This is independent of `server.rateLimit` and
keeps an unauthenticated flooder from draining the operator's RPC quota by spamming bogus proofs.

### Multiple auth methods

Auth can be an array. Any method succeeding is sufficient (any-of semantics):

```yaml
auth:
  - type: x402
    network: 8453
    rpc: https://mainnet.base.org
    token: '0xA0b8...'
    amount: '1000000'
    recipient: '0x...'
  - type: apiKey
    keys:
      - ${PARTNER_KEY}
  - type: free
```

Methods are tried in order. The first success authenticates the request. If all fail, the error from the last method is
returned (or a 402 if the last method was x402).

## Cache

Response caching.

```yaml
cache:
  maxAge: 30000 # cache responses for 30 seconds
```

| Field    | Type     | Required | Description                                                |
| -------- | -------- | -------- | ---------------------------------------------------------- |
| `maxAge` | `number` | Yes      | Cache TTL in milliseconds for responses. Positive integer. |

`maxAge` controls response caching — repeated `POST /endpoints/{id}` requests with the same parameters return the cached
response until the TTL expires. A cached response replays the same signature and timestamp, so within `maxAge` every
caller (and every on-chain submission) gets the identical signed payload.

## Endpoint-level fields

Each endpoint describes one upstream API route:

```yaml
endpoints:
  - name: coinPrice
    path: /simple/price
    method: GET
    parameters:
      - name: ids
        in: query
        required: true
    encoding:
      type: int256
      path: $.ethereum.usd
      times: '1e18'
    auth:
      type: free
    cache:
      maxAge: 30000
    description: Get the current price of a coin
```

| Field             | Type     | Required | Default | Description                                                                              |
| ----------------- | -------- | -------- | ------- | ---------------------------------------------------------------------------------------- |
| `name`            | `string` | Yes      | --      | Endpoint name. Used in logging. Not part of endpoint ID derivation.                      |
| `path`            | `string` | Yes      | --      | URL path appended to the API's `url`.                                                    |
| `method`          | `string` | No       | `GET`   | HTTP method: `GET`, `POST`, `PUT`, `PATCH`, or `DELETE`.                                 |
| `mode`            | `string` | No       | `sync`  | Response mode: `sync`, `async`, or `stream`.                                             |
| `parameters`      | `array`  | No       | `[]`    | Parameter definitions. See [Parameters](#parameters).                                    |
| `encoding`        | `object` | No       | --      | ABI encoding rules. When omitted, raw JSON is signed.                                    |
| `encrypt`         | `object` | No       | --      | FHE-encrypt the encoded value before signing. See [Encryption (FHE)](#encryption-fhe).   |
| `responseMatches` | `array`  | No       | --      | Regex patterns for TLS proof response matching. See [responseMatches](#responsematches). |
| `auth`            | `object` | No       | --      | Overrides API-level auth for this endpoint.                                              |
| `cache`           | `object` | No       | --      | Overrides API-level cache for this endpoint.                                             |
| `description`     | `string` | No       | --      | Human-readable description. Does not affect runtime behavior.                            |

### `mode`

Controls how the server delivers the response:

- **`sync`** (default) — call API, wait for result, respond with signed data in the same HTTP request.
- **`async`** — return 202 immediately with a `requestId` and `pollUrl`. The API call runs in the background. Client
  polls `GET /requests/{requestId}` until the status is `complete` or `failed`.
- **`stream`** — return the signed response as a Server-Sent Event (SSE). The response has
  `Content-Type: text/event-stream`. The full pipeline runs (including plugins), and the signed result is delivered as a
  single `data:` event with `done: true`. A pipeline error is returned as the plain HTTP error response, not an SSE
  frame.

```yaml
endpoints:
  - name: inference
    path: /v1/completions
    method: POST
    mode: async # return 202, poll for result

  - name: chat
    path: /v1/chat/completions
    method: POST
    mode: stream # return SSE events
```

The response [cache](#cache) applies to `sync`-mode endpoints only. `async` returns a `202`+`pollUrl` and `stream`
returns an SSE frame, so a cached plain-JSON body would break those response contracts — those modes neither read nor
write the cache.

## Parameters

Parameters define the inputs to an upstream API call. Each parameter specifies where to send its value and how it is
resolved.

```yaml
parameters:
  - name: ids
    in: query
    required: true
    description: Coin ID (e.g. ethereum, bitcoin)
  - name: vs_currencies
    in: query
    default: usd
```

:::note Parameter values in requests

Clients send parameter values in the request body as `{"parameters": {"name": value, ...}}`. `parameters` must be a JSON
**object** (a non-object value is rejected with `400`). The individual values are handled per parameter `in`:

- `query`, `path`, `header`, `cookie` — the value is coerced to a string. **Pass a string** (or a number/boolean);
  passing a nested object or array here produces a stringified placeholder, not what you want.
- `body` — the value is serialized whole into the upstream request body, so **nested JSON is supported and expected**
  here (e.g. a JSON-RPC `params: [{ "to": "0x...", "data": "0x..." }, "latest"]`).

In short: only `body` parameters may be nested; everything else should be a primitive.

:::

### Parameter fields

| Field         | Type                          | Required | Default | Description                                                    |
| ------------- | ----------------------------- | -------- | ------- | -------------------------------------------------------------- |
| `name`        | `string`                      | Yes      | --      | Parameter name as the upstream API expects it.                 |
| `in`          | `string`                      | No       | `query` | Where to send: `query`, `header`, `path`, `cookie`, or `body`. |
| `required`    | `boolean`                     | No       | `false` | If `true`, the client must provide this parameter.             |
| `fixed`       | `string \| number \| boolean` | No       | --      | Hardcoded value. Always overrides the client's value.          |
| `default`     | `string \| number \| boolean` | No       | --      | Fallback value when the client does not provide one.           |
| `secret`      | `boolean`                     | No       | `false` | If `true`, excluded from endpoint ID derivation.               |
| `description` | `string`                      | No       | --      | Human-readable description.                                    |

### Fixed vs default

- **`fixed`** -- the value is locked. The client cannot override it. Use this for parameters the client should never
  control (e.g., forcing `localization: false` to reduce response size).
- **`default`** -- a fallback. The client can override it. Use this for sensible defaults that clients may want to
  change (e.g., `vs_currencies` defaulting to `usd`).

Resolution order:

1. `fixed` -- if set, always wins
2. Client-provided value -- from the request body
3. `default` -- fallback when the client provides nothing

If none produce a value and `required: true`, the request fails with a validation error.

A parameter cannot have both `required: true` and a `default` value. If you set a default, the parameter is implicitly
optional — there is always a fallback value. The schema validator rejects this combination.

### Secret parameters

Parameters marked `secret: true` are excluded from endpoint ID derivation. This means changing a secret parameter does
not change the endpoint ID.

Parameters with `fixed` values that use `${VAR}` interpolation are also treated as secret automatically.

### Query parameters

The default. Appended to the upstream URL query string:

```yaml
parameters:
  - name: ids
    in: query
    required: true
  - name: vs_currencies
    in: query
    default: usd
```

Request to `/simple/price?ids=ethereum&vs_currencies=usd`.

### Path parameters

Use `{paramName}` placeholders in the endpoint path:

```yaml
endpoints:
  - name: coinMarketData
    path: /coins/{coinId}
    parameters:
      - name: coinId
        in: path
        required: true
```

When the client provides `coinId: ethereum`, the URL becomes `/coins/ethereum`.

### Header parameters

Sent as HTTP headers on the upstream request:

```yaml
parameters:
  - name: X-Custom-Header
    in: header
    fixed: special-value
```

### Body parameters

For POST endpoints. All `in: body` parameters are collected into a flat JSON object:

```yaml
endpoints:
  - name: generateInteger
    path: /json-rpc/4/invoke
    method: POST
    parameters:
      - name: jsonrpc
        in: body
        fixed: '2.0'
      - name: method
        in: body
        fixed: generateIntegers
      - name: min
        in: body
        default: 0
      - name: max
        in: body
        default: 100
```

Produces the request body:

```json
{ "jsonrpc": "2.0", "method": "generateIntegers", "min": 0, "max": 100 }
```

### Cookie parameters

Sent as cookies on the upstream request, joined into a single `Cookie` header:

```yaml
parameters:
  - name: session_token
    in: cookie
    fixed: ${SESSION_TOKEN}
    secret: true
```

Cookie values are concatenated verbatim, so a value containing `;`, CR, or LF (which would let it inject extra cookie
pairs or split the header) is rejected — keep cookie values to ordinary cookie content.

## `responseMatches`

Defines regex patterns that a TLS proof attestor checks against the API response. Required for
[TLS proof](/docs/concepts/proofs) generation. Endpoints without `responseMatches` skip proof generation even when proof
is enabled globally in `settings`.

```yaml
responseMatches:
  - type: regex
    value: '"usd":\s*(?<price>[\d.]+)'
```

| Field   | Type     | Required | Description                             |
| ------- | -------- | -------- | --------------------------------------- |
| `type`  | `string` | Yes      | Must be `'regex'`.                      |
| `value` | `string` | Yes      | Regex pattern to match in the response. |

Multiple patterns can be specified. The attestor must match all of them for the proof to be generated.

## Encoding

The `encoding` field controls how the API response is ABI-encoded before signing. When omitted, the raw JSON response is
signed directly.

```yaml
encoding:
  type: int256
  path: $.ethereum.usd
  times: '1e18'
```

| Field   | Type     | Required | Description                                                                     |
| ------- | -------- | -------- | ------------------------------------------------------------------------------- |
| `type`  | `string` | No       | Solidity type(s) for ABI encoding: `int256`, `uint256`, `bool`, `bytes32`, etc. |
| `path`  | `string` | No       | JSONPath expression to extract the value from the API response.                 |
| `times` | `string` | No       | Multiplier applied before encoding. Converts decimals to integers for Solidity. |

All fields are optional individually. The encoding is complete when both `type` and `path` are present — either from the
config, from the requester's request parameters, or a combination of both. See
[requester-specified encoding](#requester-specified-encoding) below.

### Multi-value encoding

Encode multiple values from a single API response using comma-separated `type`, `path`, and `times`:

```yaml
encoding:
  type: int256,uint256
  path: $.ethereum.usd,$.ethereum.usd_24h_vol
  times: '1e18,1e18'
```

Entries are positionally matched -- the first type pairs with the first path and first times value.

### Raw JSON (no encoding)

Omit the `encoding` field entirely. The raw JSON response is hashed and signed:

```yaml
endpoints:
  - name: coinPriceRaw
    path: /simple/price
    method: GET
    parameters:
      - name: ids
        in: query
        required: true
    # No encoding -- raw JSON response is signed
```

### Empty responses (204 No Content)

When the upstream API returns an empty body (e.g. HTTP 204), the behavior depends on the encoding mode:

- **Raw mode** — returns `rawData: null` with a valid signature. The signature covers `keccak256(toHex("null"))`,
  providing a verifiable attestation that the API returned no content.
- **Encoded mode** — returns HTTP 502 with `"API returned no data to encode"`. There is no value to extract via
  JSONPath, so encoding cannot proceed.

Empty JSON objects (`{}`) behave similarly — raw mode signs them as-is, while encoded mode fails if the JSONPath finds
no value at the configured path.

### Requester-specified encoding

Clients can control encoding by passing reserved parameters in their request body: `_type`, `_path`, and optionally
`_times`. These parameters are consumed by the pipeline and never sent to the upstream API.

**Three modes:**

1. **Operator-fixed** — the endpoint has a complete `encoding` block (`type` + `path`). Client reserved parameters are
   ignored. The endpoint ID commits to this encoding.
2. **Partial** — the endpoint has an `encoding` block with some fields (e.g. `type` only). The client fills in the
   missing fields via `_path` or `_times`. Operator fields take precedence.
3. **Requester-only** — no `encoding` block. The client provides `_type` and `_path`. If neither is provided, raw JSON
   mode is used.

```bash
# Requester chooses what to extract from a raw endpoint
curl -X POST http://localhost:3000/endpoints/{endpointId} \
  -H "Content-Type: application/json" \
  -d '{"parameters":{"ids":"ethereum","vs_currencies":"usd","_type":"int256","_path":"$.ethereum.usd","_times":"1e18"}}'
```

```yaml
# Partial: operator fixes the type, requester chooses the path
endpoints:
  - name: flexiblePrice
    path: /simple/price
    encoding:
      type: int256
    # path comes from the requester's _path parameter
```

If the merged result has `_type` without `_path` (or vice versa), the server returns 400.

## Encryption (FHE)

The `encrypt` field FHE-encrypts the encoded value before signing, so the signed `data` is an encrypted-input handle
instead of plaintext. It requires [`settings.fhe`](/docs/config/settings#fhe) to be configured, and the endpoint must
have an `encoding` block whose `type` is `int256` or `uint256` with a `path` set — FHE integers are unsigned, so the
encoded value must be a single non-negative integer that fits in the chosen ciphertext type.

```yaml
endpoints:
  - name: coinPrice
    path: /simple/price
    encoding:
      type: int256
      path: $.ethereum.usd
      times: '1e18'
    encrypt:
      type: euint256
      contract: '0x5FbDB2315678afecb367f032d93F642f64180aa3'
```

| Field      | Type     | Required | Description                                                                                                                                               |
| ---------- | -------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`     | `string` | Yes      | FHE ciphertext type. One of `euint8`, `euint16`, `euint32`, `euint64`, `euint128`, `euint256`. The encoded value must fit in this width.                  |
| `contract` | `string` | Yes      | Address of the consumer contract that will ingest the encrypted input. Operator-fixed — requesters cannot override it, and the endpoint ID commits to it. |

See [FHE Encryption](/docs/concepts/fhe-encryption) for the full flow, the address-binding rules, and the consumer
contract requirements.
