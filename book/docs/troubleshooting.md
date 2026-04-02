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

### `Both _type and _path are required for encoding` (400)

**Cause:** The request includes `_type` without `_path` or vice versa. These reserved parameters must be sent together.

**Fix:** Send both `_type` and `_path`, or omit both to get a raw JSON response.

```json
{
  "parameters": {
    "ids": "ethereum",
    "vs_currencies": "usd",
    "_type": "int256",
    "_path": "ethereum.usd",
    "_times": "1000000000000000000"
  }
}
```

### `Request body too large` (413)

**Cause:** The request body exceeds the size limit. Airnode allows up to 64KB.

**Fix:** Reduce the request payload size. If you need to send large bodies, check whether the parameters can be
simplified.

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

## General debugging

**Check the logs.** Airnode logs every request with its endpoint ID, response status, and processing time. Set
`LOG_LEVEL=debug` for detailed pipeline output including upstream request/response details.

**Verify the config.** Run `airnode validate` to check your config against the schema before starting the server.

**Test the upstream API directly.** Use curl to call the upstream API with the same parameters the airnode would use.
This isolates whether the issue is in the airnode or the upstream.

```bash
# Example: test the upstream directly
curl "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd"
```
