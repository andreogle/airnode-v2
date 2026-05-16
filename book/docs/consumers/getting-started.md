---
slug: /consumers/getting-started
sidebar_position: 0
---

# Getting Started

You have an airnode URL and want to get signed data. This walkthrough takes you from zero to a verified response.

## Step 1: Check if the airnode is running

```bash
curl http://airnode.example.com/health
```

```json
{
  "status": "ok",
  "airnode": "0xd1e98F3Ac20DA5e4da874723517c914a31b0e857"
}
```

Save the `airnode` address. You need it to verify signatures.

## Step 2: Verify the operator

Before trusting an airnode, verify that it is operated by the API provider — not a third party. Use
[DNS identity verification](/docs/security/identity-verification) (ERC-7529) to confirm the airnode address is
associated with the API provider's domain. A first-party airnode (operated by the data source) provides the strongest
trust guarantees. See the [Trust Model](/docs/security/trust-model) for why this matters.

## Step 3: Find your endpoint ID

The airnode operator provides the endpoint ID for each API route. It is a `bytes32` hash derived from the endpoint's API
specification (URL, path, method, non-secret parameters, and encoding). The operator's documentation lists available
endpoint IDs and their expected parameters.

## Step 4: Make a request

Call the endpoint with parameters in the JSON body.

```bash
curl -X POST http://airnode.example.com/endpoints/0x1c3e0fa5ac82e5514e0e9abac98e0b8e6c58b7bea12ae0393e4e4abe64ab9620 \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: your-key" \
  -d '{"parameters":{"ids":"ethereum","vs_currencies":"usd"}}'
```

The response contains the data and a signature:

```json
{
  "airnode": "0xd1e98F3Ac20DA5e4da874723517c914a31b0e857",
  "endpointId": "0x1c3e0fa5ac82e5514e0e9abac98e0b8e6c58b7bea12ae0393e4e4abe64ab9620",
  "timestamp": 1700000000,
  "data": "0x0000000000000000000000000000000000000000000000d8e29e69b3e1e80000",
  "signature": "0x3a4e...signed"
}
```

If the endpoint has no encoding configured, you get `rawData` instead of `data`:

```json
{
  "airnode": "0xd1e98F3Ac20DA5e4da874723517c914a31b0e857",
  "endpointId": "0x1c3e0fa5ac82e5514e0e9abac98e0b8e6c58b7bea12ae0393e4e4abe64ab9620",
  "timestamp": 1700000000,
  "rawData": { "ethereum": { "usd": 3842.17 } },
  "signature": "0x3a4e...signed"
}
```

## Step 5: Verify the signature

Recover the signer address and compare it to the airnode address from `/health`.

```typescript
import { recoverAddress, hashMessage, keccak256, encodePacked, type Hex } from 'viem';

const endpointId = '0x1c3e0fa5ac82e5514e0e9abac98e0b8e6c58b7bea12ae0393e4e4abe64ab9620' as Hex;
const timestamp = 1700000000n;
const data = '0x0000000000000000000000000000000000000000000000d8e29e69b3e1e80000' as Hex;
const signature = '0x3a4e...signed' as Hex;
const expectedAirnode = '0xd1e98F3Ac20DA5e4da874723517c914a31b0e857';

// Reconstruct the message hash
const messageHash = keccak256(encodePacked(['bytes32', 'uint256', 'bytes'], [endpointId, timestamp, data]));

// Recover the signer
const recovered = await recoverAddress({
  hash: hashMessage({ raw: messageHash }),
  signature,
});

if (recovered.toLowerCase() !== expectedAirnode.toLowerCase()) {
  throw new Error('Signature verification failed');
}
```

For raw responses, hash the JSON before verifying. You must use stable (sorted-key) JSON serialization to match what the
airnode produces:

```typescript
import { keccak256, toHex } from 'viem';

// Stable stringify: sorts object keys alphabetically at every level
function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  const sorted = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${sorted.join(',')}}`;
}

const rawDataHash = keccak256(toHex(stableStringify(rawData)));
// Use rawDataHash in place of `data` in the encodePacked call above
```

## Step 6: Decode the data

Encoded responses contain ABI-encoded values. Decode them with viem.

```typescript
import { decodeAbiParameters } from 'viem';

// For an int256 value (e.g., price with 18 decimals)
const [value] = decodeAbiParameters([{ type: 'int256' }], data);

// Convert from 18 decimals to human-readable
const price = Number(value) / 1e18;
console.log(`ETH price: $${price}`); // ETH price: $3842.17
```

Raw responses need no decoding. Access the JSON directly:

```typescript
const ethPrice = rawData.ethereum.usd; // 3842.17
```

## Step 7: Submit on-chain (optional)

Pass the signed data to an on-chain verifier contract. See [On-Chain Integration](/docs/consumers/on-chain) for contract
examples using AirnodeVerifier.

## Choosing encoding at request time

Some endpoints mark one or more encoding fields with the wildcard `'*'`, letting the client choose them per request.
Supply the matching reserved parameter in the request body for each `'*'` field:

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

- `_type` -- the Solidity ABI type to encode as (`int256`, `uint256`, `bool`, `bytes32`, `address`, `string`, `bytes`).
  Only consumed when the operator set `encoding.type: '*'`.
- `_path` -- JSONPath expression to extract from the upstream response. Only consumed when `encoding.path: '*'`.
- `_times` -- multiplier applied before encoding (numeric types only). Only consumed when `encoding.times: '*'`.

If a wildcard field's matching reserved parameter is missing, the server returns 400. If the operator pinned a field
(concrete value rather than `'*'`), any client-supplied reserved parameter for it is silently ignored — the operator's
value wins. Endpoints with no `encoding` block at all return raw JSON; reserved parameters cannot synthesize encoding
out of nothing.

## What can go wrong

| Status | Error                                                | What to do                                                                                |
| ------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `400`  | `Missing required parameter(s): X`                   | Add the missing parameters to your request body.                                          |
| `400`  | `` Endpoint requires `_type` request parameter ``    | The operator marked `type: '*'`. Supply `_type` in `parameters`.                          |
| `400`  | `` Endpoint requires `_path` request parameter ``    | The operator marked `path: '*'`. Supply `_path` in `parameters`.                          |
| `400`  | `` Endpoint requires `_times` request parameter ``   | The operator marked `times: '*'`. Supply `_times` in `parameters`.                        |
| `401`  | `Missing X-Api-Key header`                           | The endpoint requires authentication. Add `X-Api-Key: your-key` to the request.           |
| `401`  | `Invalid API key`                                    | The key value is wrong. Check with the airnode operator.                                  |
| `404`  | `Endpoint not found`                                 | The endpoint ID is incorrect. Verify the ID with the operator.                            |
| `413`  | `Request body too large`                             | The request body exceeds 64KB. Reduce the payload size.                                   |
| `415`  | `Content-Type must be application/json`              | Set `Content-Type: application/json`.                                                     |
| `429`  | `Too Many Requests`                                  | Wait and retry. The airnode has a request rate limit configured.                          |
| `502`  | `API call failed`                                    | The upstream API is unreachable or returning errors. Try again later.                     |
| `502`  | `No value found at path: $.X`                        | The upstream response shape changed or the path is wrong. Contact the operator.           |
