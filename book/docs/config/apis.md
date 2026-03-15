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

### NFT key

Clients prove they hold an NFT from the operator's collection. The airnode checks on-chain ownership via RPC:

```yaml
auth:
  type: nftKey
  chain: 8453 # chain ID where the NFT contract lives
  rpc: https://mainnet.base.org
  contract: '0x...' # ERC-721 contract address
  cacheTtl: 60000 # cache ownership checks for 60 seconds
```

The client sends `Authorization: Bearer <address>:<timestamp>:<signature>` where the signature is an EIP-191 personal
sign over `airnode-auth:<address>:<timestamp>`. The server verifies the signature, checks the timestamp is within 5
minutes, and calls `balanceOf(address)` on the NFT contract. Ownership is cached for `cacheTtl` milliseconds.

### x402 (HTTP-native payment)

Pay-per-request using on-chain transfers. When a client requests without payment, the server returns a 402:

```yaml
auth:
  type: x402
  network: 8453 # chain ID for payment
  rpc: https://mainnet.base.org
  token: '0xA0b8...' # ERC-20 address (or 0x000...0 for ETH)
  amount: '1000000' # in token's smallest unit (e.g. 1 USDC = 1000000)
  recipient: '0x...' # operator's address
  expiry: 300000 # payment window in ms (default 5 min)
```

Flow: client POSTs → gets 402 with payment details → sends on-chain transfer → retries with `X-Payment-Proof: <txHash>`
→ server verifies the receipt → serves the response. Each tx hash can only be used once.

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

Response caching and optional delay for push path OEV (Oracle Extractable Value) windows.

```yaml
cache:
  maxAge: 30000 # cache pull responses for 30 seconds
  delay: 60000 # delay push beacon data by 60 seconds
```

| Field    | Type     | Required | Description                                                            |
| -------- | -------- | -------- | ---------------------------------------------------------------------- |
| `maxAge` | `number` | Yes      | Cache TTL in milliseconds for pull responses. Positive integer.        |
| `delay`  | `number` | No       | Delay before push beacon data is publicly accessible, in milliseconds. |

`maxAge` controls pull path caching — repeated `POST /endpoints/{id}` requests with the same parameters return the
cached response until the TTL expires.

`delay` controls push path visibility — beacon data at `GET /beacons/{id}` is held back until the delay window has
passed. Pull requests are not affected by `delay`. This creates an OEV window where searchers with direct access can
extract value before the data appears on-chain.

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
      delay: 60000
    push:
      interval: 10000
    description: Get the current price of a coin
```

| Field         | Type     | Required | Default | Description                                                   |
| ------------- | -------- | -------- | ------- | ------------------------------------------------------------- |
| `name`        | `string` | Yes      | --      | Endpoint name. Used in logging and endpoint ID derivation.    |
| `path`        | `string` | Yes      | --      | URL path appended to the API's `url`.                         |
| `method`      | `string` | No       | `GET`   | HTTP method: `GET`, `POST`, `PUT`, `PATCH`, or `DELETE`.      |
| `mode`        | `string` | No       | `sync`  | Response mode: `sync`, `async`, or `stream`.                  |
| `parameters`  | `array`  | No       | `[]`    | Parameter definitions. See [Parameters](#parameters).         |
| `encoding`    | `object` | No       | --      | ABI encoding rules. When omitted, raw JSON is signed.         |
| `auth`        | `object` | No       | --      | Overrides API-level auth for this endpoint.                   |
| `cache`       | `object` | No       | --      | Overrides API-level cache for this endpoint.                  |
| `push`        | `object` | No       | --      | Background push loop configuration. See [Push](#push).        |
| `description` | `string` | No       | --      | Human-readable description. Does not affect runtime behavior. |

### `mode`

Controls how the server delivers the response:

- **`sync`** (default) — call API, wait for result, respond with signed data in the same HTTP request.
- **`async`** — return 202 immediately with a `requestId` and `pollUrl`. The API call runs in the background. Client
  polls `GET /requests/{requestId}` until the status is `complete` or `failed`.
- **`stream`** — return the signed response as a Server-Sent Event (SSE). The response has
  `Content-Type: text/event-stream`. The full pipeline runs (including plugins), and the signed result is delivered as a
  single `data:` event with `done: true`.

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
    required: true
    default: usd
```

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
        required: true
        default: 0
      - name: max
        in: body
        required: true
        default: 100
```

Produces the request body:

```json
{ "jsonrpc": "2.0", "method": "generateIntegers", "min": 0, "max": 100 }
```

### Cookie parameters

Sent as cookies on the upstream request:

```yaml
parameters:
  - name: session_token
    in: cookie
    fixed: ${SESSION_TOKEN}
    secret: true
```

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
| `type`  | `string` | Yes      | Solidity type(s) for ABI encoding: `int256`, `uint256`, `bool`, `bytes32`, etc. |
| `path`  | `string` | Yes      | JSONPath expression to extract the value from the API response.                 |
| `times` | `string` | No       | Multiplier applied before encoding. Converts decimals to integers for Solidity. |

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

## Push

The `push` field enables a background loop that calls the upstream API on a fixed interval and stores signed data for
relayers.

```yaml
push:
  interval: 10000 # call API every 10 seconds
```

| Field      | Type     | Required | Description                                      |
| ---------- | -------- | -------- | ------------------------------------------------ |
| `interval` | `number` | Yes      | Loop interval in milliseconds. Positive integer. |

Pushed data is available via `GET /beacons` and `GET /beacons/{beaconId}`. If the endpoint also has a `cache.delay`, the
beacon data is not served until the delay has elapsed.
