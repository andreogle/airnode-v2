---
slug: /troubleshooting
sidebar_position: 9
---

# Troubleshooting

Common errors, what causes them, and how to fix them.

## Configuration errors

### `Environment variable X is referenced in config but not set`

**Cause:** Your `config.yaml` uses `${VAR_NAME}` interpolation, but the variable is not defined in the environment or
`.env` file.

**Fix:** Create a `.env` file in the same directory as `config.yaml` and define the variable. Bun loads `.env`
automatically -- no dotenv needed.

```bash
# .env
COINGECKO_URL=https://api.coingecko.com/api/v3
API_KEY_1=your-key-here
```

### `AIRNODE_PRIVATE_KEY environment variable is required`

**Cause:** The server cannot start without a private key to derive the airnode address and sign responses.

**Fix:** Add `AIRNODE_PRIVATE_KEY` to your `.env` file. It must be a valid 32-byte hex string with the `0x` prefix.

```bash
# .env
AIRNODE_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

### `A parameter cannot be both required and have a default value`

**Cause:** An endpoint parameter in `config.yaml` has both `required: true` and a `default` value. These are mutually
exclusive -- a required parameter must come from the client, while a default provides a fallback when the client omits
it.

**Fix:** Remove either `required` or `default` from the parameter definition.

```yaml
# Wrong
parameters:
  - name: limit
    required: true
    default: '10'

# Correct: optional with a default
parameters:
  - name: limit
    default: '10'

# Correct: required, no default
parameters:
  - name: limit
    required: true
```

## Client request errors

### `Endpoint not found` (404)

**Cause:** The endpoint ID in the URL does not match any endpoint registered in the airnode's config.

**Fix:** Verify the endpoint ID is correct. The airnode logs all registered endpoint IDs on startup. Check the
operator's documentation for the correct ID.

### `Missing X-Api-Key header` (401)

**Cause:** The endpoint has `auth.type: 'apiKey'` configured, and the request does not include an `X-Api-Key` header.

**Fix:** Add the header to your request.

```bash
curl -X POST http://airnode.example.com/endpoints/0x... \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: your-key" \
  -d '{"parameters":{}}'
```

### `Invalid API key` (401)

**Cause:** The `X-Api-Key` header value does not match any key in the endpoint's (or API's) `auth.keys` list.

**Fix:** Check the key value with the airnode operator. Keys are case-sensitive.

### `Missing required parameter(s): X` (400)

**Cause:** The endpoint defines required parameters that are not present in the request body.

**Fix:** Include all required parameters in the `parameters` object of the request body. Check the endpoint
specification for the full parameter list.

### ``Endpoint requires `_type` request parameter`` (400)

(Or `` `_path` ``, or `` `_times` ``.)

**Cause:** The operator marked one or more encoding fields with the wildcard `'*'`. Each wildcard field requires the
matching reserved parameter (`_type` / `_path` / `_times`) in the request body. This 400 means at least one is missing.

**Fix:** Supply every wildcarded field. The operator's documentation should list which fields are wildcarded — they
correspond to whichever ones appear as `*` in the canonical endpoint spec.

```json
{
  "parameters": {
    "ids": "ethereum",
    "vs_currencies": "usd",
    "_type": "int256",
    "_path": "$.ethereum.usd",
    "_times": "1e18"
  }
}
```

If the operator pinned a field, any reserved parameter you send for that field is silently ignored — the operator's
value wins. If the endpoint has no `encoding` block at all, you'll get raw JSON back regardless of reserved parameters.

### `Request body too large` (413)

**Cause:** The request body exceeds the size limit. Airnode allows up to 64KB.

**Fix:** Reduce the request payload size. If you need to send large bodies, check whether the parameters can be
simplified.

### `Too Many Requests` (429)

**Cause:** You've exceeded `server.rateLimit.max` requests per IP within `server.rateLimit.window`. Each upstream API
call costs the operator (metered API quotas), so the airnode caps per-IP throughput.

**Fix:** Throttle your client. If you're behind a NAT or shared IP, ask the operator whether they trust an
`X-Forwarded-For` header from your environment — if so, they can enable `rateLimit.trustForwardedFor` and the limit
applies per real client.

### `Too many x402 verification attempts — slow down` (401)

**Cause:** You're an x402 client and you're submitting payment proofs faster than `server.rateLimit.x402.max` per
`window`. This is a separate, stricter bucket from the global rate limit — each submitted proof triggers several
chain-RPC reads, so unauthenticated flooders are throttled hard.

**Fix:** Slow down proof submission. Only submit proofs for transactions you actually intend the airnode to verify;
don't speculatively spam unverified `txHash` values.

### `Payment required` (402)

**Cause:** The endpoint has `auth.type: 'x402'` and you haven't supplied a valid payment proof.

**Fix:** The 402 response body includes `airnode`, `endpointId`, `amount`, `token`, `network`, `recipient`, and
`expiresAt`. Send the on-chain transfer, then retry with an `X-Payment-Proof` header containing
`{ "txHash": "0x…", "expiresAt": <unix-seconds>, "signature": "0x…" }`. The signature is over
`keccak256(encodePacked(airnode, endpointId, uint64(expiresAt)))` from the payer's EOA.

### `Server busy` (503)

**Cause:** The airnode is already running `settings.maxConcurrentApiCalls` upstream requests and your request waited
its full timeout for a slot without getting one.

**Fix:** Operator-side: raise `maxConcurrentApiCalls` if the upstream can handle it, or front the airnode with a CDN
that caches frequent endpoints. Client-side: slow your request rate or add jitter.

## Upstream API errors

### `API call failed` (502)

**Cause:** The upstream API is unreachable, returned a non-2xx status code, or the response could not be parsed.

**Fix:** Verify the upstream API is accessible from the airnode's network. Check the `apis[].url` and endpoint `path` in
the config. Review airnode logs for the upstream status code and response body.

### `API returned no data to encode` (502)

**Cause:** The upstream API returned an empty body (e.g., HTTP 204) on an endpoint that has encoding configured.
Encoding requires a JSON response to extract a value from.

**Fix:** Check why the upstream API returns an empty response. The API route may require different parameters, or the
endpoint path in the config may be wrong.

### `No value found at path: $.foo` (502)

**Cause:** The JSONPath configured in the endpoint's `encoding.path` does not match the structure of the upstream API
response.

**Fix:** Inspect the actual upstream response and adjust the `path` in the endpoint's encoding config. Common causes:
the API changed its response format, a nested field was renamed, or the path uses the wrong separator.

## FHE encryption errors

### `FHE encryption failed` (502)

**Cause:** The endpoint has an `encrypt` block, but the relayer rejected the encryption attempt. Common subcauses
appear in the server log: a negative integer for an unsigned ciphertext (`euint*` types are unsigned), a value that
overflows the chosen ciphertext type, or the relayer being unreachable.

**Fix:** Check the airnode logs for the specific error. Common fixes: choose a larger `encrypt.type` (e.g.
`euint256` instead of `euint64`); pin a non-negative encoding (`uint256` instead of `int256`); or verify
`settings.fhe.rpcUrl` and `settings.fhe.apiKey` are correct.

### `Endpoint requires FHE encryption but settings.fhe is not configured`

**Cause:** An endpoint has `encrypt: { ... }` but `settings.fhe` is `'none'`.

**Fix:** Either remove `encrypt` from the endpoint or set `settings.fhe` to a configured relayer block.
Config-validation catches this at startup, so seeing it at runtime usually means the config was edited without
restarting.

## Plugin errors

### `Plugin "X" budget exhausted` (request dropped, 403)

**Cause:** A plugin defining a mutation hook (`onHttpRequest`, `onBeforeApiCall`, `onAfterApiCall`, `onBeforeSign`) has
spent its full `timeout` budget on previous hook invocations within the same request. Mutation hooks are fail-closed —
once the budget is gone, the request is dropped rather than being processed without the plugin's intervention.

**Fix:** Operator-side: raise the plugin's `timeout` in `settings.plugins[].timeout`. Plugin-author side: pass each
hook's `signal` to your `fetch` calls so cancellation actually propagates, and avoid unnecessary work in earlier hooks.

### Plugin runs only on the first request in a cache window

**Cause:** Not an error — by design. Cached responses bypass the upstream API call, which also bypasses the
`onBeforeApiCall`, `onAfterApiCall`, and `onBeforeSign` hooks. Only `onHttpRequest`, `onResponseSent`, and `onError`
fire on every request.

**Fix:** If you need per-request signal, use `onResponseSent` or `onHttpRequest`. See
[Plugins → Caching interaction](/docs/config/plugins#caching-interaction).

## Async endpoint errors

### `Request not found` (404) on `GET /requests/{requestId}`

**Cause:** The request ID is wrong, or it's older than the async store's retention window (10 minutes for in-flight
requests, 1 minute for completed/failed results). Finished results are evicted promptly so an unrelated request can
take its slot.

**Fix:** Poll within the retention window. If you waited longer, the result is gone — re-submit the request.

### `Service Unavailable` (503) from a `mode: async` endpoint

**Cause:** The async store is at its 100-entry cap and no slot can be safely evicted (every entry is still in-flight
within its TTL or holds an unread result within its retention window).

**Fix:** This indicates sustained submission rate exceeding the airnode's async capacity. Wait, retry, or have the
operator review whether `mode: async` is appropriate for that workload.

## CORS errors

### Browser rejects response: `CORS policy: No 'Access-Control-Allow-Origin' header`

**Cause:** The airnode's `server.cors` is configured with an `origins` allow-list that doesn't include your origin.
Non-matching origins receive `Access-Control-Allow-Origin: null`, which browsers refuse.

**Fix:** Operator-side: add your origin to `server.cors.origins`, or remove the `cors` block entirely (defaults to
allowing every origin). Verify with `curl -i -H 'Origin: https://your-app.example' …` — the airnode echoes the matched
origin back in the response header.

## General debugging

**Check the logs.** Airnode logs every request with its endpoint ID, response status, and processing time. Set
`LOG_LEVEL=debug` for detailed pipeline output including upstream request/response details.

**Verify the config.** Run `airnode config validate -c config.yaml` to check your config against the schema before
starting the server.

**Test the upstream API directly.** Use curl to call the upstream API with the same parameters the airnode would use.
This isolates whether the issue is in the airnode or the upstream.

```bash
# Example: test the upstream directly
curl "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd"
```
