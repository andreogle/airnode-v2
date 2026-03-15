# Integration Test Scenarios

Integration tests run against a live Airnode HTTP server with a mock upstream API. Each scenario starts a server, sends
HTTP requests, and asserts on responses. Tests are grouped by attack surface.

## Setup

Each test file:

1. Starts a mock upstream API (`Bun.serve`) that returns controlled JSON responses
2. Starts the Airnode server with a test config pointing at the mock API
3. Sends HTTP requests to the Airnode server
4. Asserts on response status, body, headers, and signature validity

The mock API server runs once in the sequential runner (`run-sequential.ts`). Each test file runs in its own bun
subprocess to avoid shared cache/state. The mock provides control endpoints (`/mock/set-response`, `/mock/calls`,
`/mock/reset`) for per-test customization.

## Scenarios

### S1 — Signed response round-trip

Verify the core pipeline: request → upstream API call → ABI encode → sign → respond.

- POST to a valid endpoint with encoding, verify response has `requestId`, `airnode`, `endpointId`, `timestamp`, `data`,
  `signature`
- Recover the airnode address from the signature and confirm it matches `airnode`
- ABI-decode `data` and confirm it matches the expected value from the mock API response
- Verify `endpointId` matches the expected derivation from the config

**Status:** Implemented (`s1-signed-response.test.ts`)

### S2 — Raw response (no encoding)

Endpoints without `encoding` return raw JSON with a signature over the JSON hash.

- POST to an endpoint with no encoding block
- Response has `rawData` (not `data`) containing the full upstream JSON
- Signature covers `keccak256(requestId || keccak256(rawJsonAsHex))`
- Recover airnode address from signature

**Status:** Implemented (`s2-raw-response.test.ts`)

### S3 — Client authentication

- **Free auth:** endpoint with `auth: { type: free }` — any request succeeds (no headers needed)
- **API key auth:** endpoint with `auth: { type: apiKey, keys: [...] }` — valid key in `X-Api-Key` header succeeds,
  missing header returns 401, invalid key returns 401
- **Inheritance:** API-level auth applies to endpoints that don't override it
- **No auth:** API with no `auth` block is accessible without credentials

**Status:** Implemented (`s3-client-auth.test.ts`)

### S4 — Required parameter validation

- POST with all required parameters succeeds
- POST missing a required parameter returns 400 with the missing parameter name in the error
- Required parameters with `fixed` values don't need to be in the request body
- Required parameters with `default` values don't need to be in the request body
- Non-required parameters can be omitted without error

**Status:** Implemented (`s4-required-params.test.ts`)

### S5 — Fixed and default parameters

- `fixed` parameters are sent to the upstream API regardless of request body (verify via mock API)
- `fixed` parameters cannot be overridden by request body values
- `default` parameters are used when the request body omits them
- `default` parameters can be overridden by request body values
- Upstream API receives configured `headers` from the API config
- Path parameters are substituted in the URL

**Status:** Implemented (`s5-fixed-default-params.test.ts`)

### S6 — Secret parameter exclusion from endpoint ID

- Two endpoints identical except one has a `secret: true` parameter produce the same endpoint ID
- Parameters with `fixed: '${ENV_VAR}'` produce the same endpoint ID as the version without that parameter
- Non-secret `fixed` parameters DO affect the endpoint ID

**Status:** Implemented (`s6-secret-params.test.ts`)

### S7 — Response caching

- First request hits the upstream API, second request with same params returns cached response (verify mock API called
  once)
- Cached response has identical `data`, `signature`, `requestId`, `timestamp` as original
- Different parameters produce different cache keys (both hit the upstream API)
- Endpoint without cache config does not cache

**Status:** Implemented (`s7-caching.test.ts`)

### S8 — Rate limiting

- Requests within the rate limit succeed (200)
- Requests exceeding the rate limit return 429

**Status:** Implemented (`s8-rate-limiting.test.ts`)

### S9 — Request body security

- Body exceeding 64KB returns 413
- Non-JSON content type returns 415
- Malformed JSON body is treated as empty parameters (not a 400 — graceful degradation)
- Empty body is treated as empty parameters

**Status:** Implemented (`s9-request-body-security.test.ts`)

### S10 — CORS and preflight

- GET /health includes `Access-Control-Allow-Origin` header from config
- OPTIONS request returns 204 with correct CORS headers (`Allow-Methods`, `Allow-Headers`, `Max-Age`)

**Status:** Implemented (`s10-cors.test.ts`)

### S11 — SSRF prevention

- Path parameters with traversal attempts (`../../admin`) are URL-encoded and don't escape the API base URL
- The constructed URL's origin stays under the configured API base

**Status:** Implemented (`s11-ssrf-prevention.test.ts`)

### S12 — Plugin hooks — onHttpRequest

- A plugin can reject a request early (returns custom status and message)
- A plugin returning `undefined` allows the request to proceed
- Plugin errors don't crash the server — request continues

**Status:** Implemented (`s12-plugin-http-request.test.ts`)

### S13 — Plugin hooks — onBeforeApiCall / onAfterApiCall

- `onBeforeApiCall` can modify request parameters (verify modified params reach the mock API)
- `onAfterApiCall` can modify the API response (verify modified data in signed response)
- Plugin returning `undefined` passes through without modification

**Status:** Implemented (`s13-plugin-api-call.test.ts`)

### S14 — Plugin hooks — onBeforeSign

- `onBeforeSign` can modify the encoded data before signing
- Modified data is what gets signed (verify by recovering signature)

**Status:** Implemented (`s14-plugin-before-sign.test.ts`)

### S15 — Plugin hooks — onResponseSent / onError

- `onResponseSent` fires after successful responses with correct duration
- `onError` fires when processing fails (e.g. encoding error from wrong response shape)
- Plugin errors in observation hooks don't affect the response

**Status:** Implemented (`s15-plugin-observation.test.ts`)

### S16 — Plugin budget exhaustion

- Mutation hooks (onBeforeApiCall) drop the request when budget is exhausted
- Observation hooks (onResponseSent) are skipped silently when budget is exhausted
- Budget resets between requests

**Status:** Implemented (`s16-plugin-budget.test.ts`)

### S17 — Upstream API failure handling

- Upstream API returning wrong response shape → airnode returns 502
- Error details are not leaked to the client (generic error message)

**Status:** Implemented (`s17-upstream-failure.test.ts`)

### S18 — Multi-value encoding

- Endpoint with comma-separated `encoding` correctly ABI-encodes multiple values
- Decoded values match expected magnitudes

**Status:** Implemented (`s18-multi-value-encoding.test.ts`)

### S19 — Endpoint ID determinism

- The same API + endpoint config always produces the same endpoint ID
- Parameter order doesn't affect the endpoint ID (sorted by name)
- Different `url` values produce different endpoint IDs
- Different `encoding` specs produce different endpoint IDs
- Adding/removing encoding changes the endpoint ID

**Status:** Covered by unit tests (`src/endpoint.test.ts`, `s6-secret-params.test.ts`)

### S20 — Health endpoint

- GET /health returns `{ status: 'ok', version, airnode }`
- `airnode` matches the address derived from `AIRNODE_PRIVATE_KEY`
- `version` matches `package.json` version
- Returns 404 for unknown routes, 405 for non-POST to /endpoints/{id}

**Status:** Implemented (`s20-health.test.ts`)

### S21 — Request logging context

- Log messages during request processing include `requestId=0x...`
- Different requests get different requestIds

**Status:** Implemented (`s21-logging-context.test.ts`)

### S22 — Config validation

- Invalid YAML is rejected with parse error
- Missing required fields are rejected with field path
- Invalid URL format is rejected
- Duplicate API names are rejected
- Duplicate endpoint names within an API are rejected
- Duplicate plugin sources are rejected
- Environment variable interpolation works (`${VAR}` replaced from env)
- Missing environment variable throws with variable name in error

**Status:** Covered by unit tests (`src/config/schema.test.ts`, `src/config/validate.test.ts`,
`src/config/parser.test.ts`)

### S23 — Signature verification on-chain compatibility

- The signature format `keccak256(requestId || keccak256(data))` with EIP-191 personal sign prefix produces signatures
  that a Solidity/Vyper `ecrecover` can verify
- Verify the `requestId` derivation matches `keccak256(encodePacked(endpointId, encodedParameters, timestamp))`

**Status:** Covered by unit tests (`src/sign.test.ts`) and integration (`s1-signed-response.test.ts`)

### S24 — Graceful shutdown

- SIGINT/SIGTERM triggers clean shutdown (server stops accepting requests)
- Cache sweep interval is cleared on shutdown

**Status:** Covered by implementation review (tested manually, not automatable in subprocess model)

### S25 — Concurrent request handling

- Multiple simultaneous requests to different endpoints are processed concurrently
- Multiple simultaneous requests to the same endpoint with cache share the cached response

**Status:** Implemented (`s25-concurrent-requests.test.ts`)

### S26 — Encoding edge cases

- `int256` with negative values encodes correctly (two's complement)
- `uint256` with very large values (near 2^256) encodes correctly
- `bool` accepts `true`, `false`, `"true"`, `"false"`, `1`, `0`
- `bytes32` from string pads correctly
- `address` passes through without modification
- `string` and `bytes` produce correct dynamic ABI encoding
- JSONPath extraction from nested objects and arrays works

**Status:** Covered by unit tests (`src/api/process.test.ts`)

### S27 — Private key security

- `AIRNODE_PRIVATE_KEY` is never logged
- `AIRNODE_PRIVATE_KEY` is not exposed in any response
- API keys from `headers` config are not logged (debug log redacts query params)
- Client API keys from `X-Api-Key` header are not included in error responses

**Status:** Implemented (`s27-secret-exposure.test.ts`)

### S28 — Cache sweep

- Expired entries are removed by the periodic sweep (verify memory doesn't grow unbounded)
- Expired entries return undefined on get (before sweep runs)
- `cache.stop()` clears the sweep interval

**Status:** Covered by unit tests (`src/cache.test.ts`)

### S29 — x402 payment auth

- Request without `X-Payment-Proof` header returns 402 with payment details (paymentId, amount, token, network,
  recipient, expiresAt)
- Request with valid tx hash verifies the on-chain transfer and serves the response
- Replay protection: same tx hash cannot be used twice
- ETH transfers: checks `value >= amount` and `to == recipient`
- ERC-20 transfers: parses `Transfer` event logs from the receipt
- Multi-method: x402 + apiKey fallback — API key works when payment proof is missing
- Payment details include correct token address and expiry timestamp

**Status:** Partially implemented (`s29-x402-payment.test.ts` for multi-method fallback, `src/auth.test.ts` for x402
logic). Full integration requires a live chain for payment verification.

### S30 — Async requests

- Endpoint with `async: true` returns 202 with requestId and pollUrl
- `GET /requests/{requestId}` returns status: pending → processing → complete | failed
- Complete response includes the full signed data
- Failed response includes error message
- Unknown request ID returns 404
- Requests expire after 10 minutes (cleaned by sweep)

**Status:** Implemented (`src/async.test.ts` for store logic, pipeline handles async dispatch)

### S31 — SSE streaming

- Request with `Accept: text/event-stream` returns SSE stream
- Intermediate chunks are unsigned data events with index
- Final event includes `done: true` with the complete signed response
- Response has `Content-Type: text/event-stream` and `Cache-Control: no-cache` headers
- Falls back to normal response when Accept header is not set

**Status:** Implemented in pipeline. Covered by unit tests.
