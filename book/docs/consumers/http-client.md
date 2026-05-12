---
slug: /consumers/http-client
sidebar_position: 1
---

# HTTP Client Integration

Airnode exposes a standard HTTP API. You call an endpoint, receive signed data, and optionally submit it on-chain
yourself.

## Making a request

Send a POST request to `/endpoints/{endpointId}` with parameters in the JSON body. Include an API key header if the
endpoint requires authentication.

```bash
curl -X POST http://airnode.example.com/endpoints/0x... \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: your-key" \
  -d '{"parameters":{"ids":"bitcoin","vs_currencies":"usd"}}'
```

## Response format

The response format depends on whether the endpoint has encoding configured.

### Encoded response

When the endpoint defines `encoding` (type, path, times), the response contains ABI-encoded `data` as a hex string. This
is the format you submit to on-chain contracts.

```json
{
  "airnode": "0x...",
  "endpointId": "0x...",
  "timestamp": 1700000000,
  "data": "0x...",
  "signature": "0x...",
  "proof": { "...": "present when TLS proofs are enabled" }
}
```

### Raw response

When the endpoint has no encoding, the response contains the upstream API's JSON output directly. The signature covers
the hash of the JSON data.

```json
{
  "airnode": "0x...",
  "endpointId": "0x...",
  "timestamp": 1700000000,
  "rawData": { "bitcoin": { "usd": 67432 } },
  "signature": "0x...",
  "proof": { "...": "present when TLS proofs are enabled" }
}
```

The `proof` field is only present when [TLS proofs](/docs/concepts/proofs) are enabled and the endpoint has
`responseMatches` configured.

## Signature format

Every response is signed by the airnode's private key using EIP-191 personal sign:

```
messageHash = keccak256(encodePacked(endpointId, timestamp, data))
signature = EIP-191 personal sign over messageHash
```

The signature proves the airnode endorsed this data at this timestamp for this endpoint. Anyone can verify it without
trusting the transport layer.

## Verifying signatures off-chain

Use viem (or any EIP-191 library) to recover the signer and confirm it matches the expected airnode address.

```typescript
import { recoverAddress, hashMessage, keccak256, encodePacked } from 'viem';

const messageHash = keccak256(encodePacked(['bytes32', 'uint256', 'bytes'], [endpointId, BigInt(timestamp), data]));

const recovered = await recoverAddress({
  hash: hashMessage({ raw: messageHash }),
  signature,
});

// recovered === airnode address
```

If the recovered address does not match the airnode address you expect, the data has been tampered with or was signed by
a different key.

## Authentication

Endpoints support three auth methods: `free` (no credentials), `apiKey` (via `X-Api-Key` header), and `x402`
(pay-per-request). Endpoints with `auth.type: 'apiKey'` require an `X-Api-Key` header. Endpoints with
`auth.type: 'free'` accept unauthenticated requests.

```bash
# Free endpoint -- no auth header needed
curl -X POST http://airnode.example.com/endpoints/0x... \
  -H "Content-Type: application/json" \
  -d '{"parameters":{"id":"1"}}'

# API key endpoint
curl -X POST http://airnode.example.com/endpoints/0x... \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: your-key" \
  -d '{"parameters":{"id":"1"}}'
```

## Async requests

For endpoints with `mode: async`, the initial response is a 202 with a poll URL:

```json
{
  "requestId": "0x...",
  "status": "pending",
  "pollUrl": "/requests/0x..."
}
```

Poll until complete:

```bash
curl http://airnode.example.com/requests/0x...
# → { "requestId": "0x...", "status": "complete", "data": "0x...", "signature": "0x...", ... }
```

Status transitions: `pending` → `processing` → `complete` | `failed`.

## SSE streaming

For endpoints with `mode: stream`, the response is a Server-Sent Event:

```bash
curl -X POST -N http://airnode.example.com/endpoints/0x... \
  -H "Content-Type: application/json" \
  -d '{"parameters":{"ids":"bitcoin"}}'
```

```
data: {"done":true,"airnode":"0x...","endpointId":"0x...","timestamp":1700000000,"data":"0x...","signature":"0x..."}
```

The full pipeline runs (including plugins), and the signed result is delivered as a single SSE event.

## x402 payment

> This is an x402-_flavoured_ scheme — pay on-chain first, then prove the confirmed transaction. It is **not** the x402
> wire protocol (no `X-PAYMENT`/EIP-3009 authorization).

For endpoints with x402 auth, the first request returns 402 with payment details:

```json
{
  "airnode": "0x...",
  "endpointId": "0x...",
  "amount": "1000000",
  "token": "0xA0b8...",
  "network": 8453,
  "recipient": "0x...",
  "expiresAt": 1700001000
}
```

After sending the on-chain transfer, the payer signs an authorisation binding the payment to this airnode and endpoint:

```
message = keccak256(encodePacked(airnode, endpointId, uint64(expiresAt)))
signature = EIP-191 personal-sign(message) with the EOA that sent the transaction
```

Retry with a JSON-encoded `X-Payment-Proof` header:

```bash
PROOF='{"txHash":"0x...","expiresAt":1700001000,"signature":"0x..."}'

curl -X POST http://airnode.example.com/endpoints/0x... \
  -H "Content-Type: application/json" \
  -H "X-Payment-Proof: $PROOF" \
  -d '{"parameters":{"ids":"bitcoin"}}'
```

The server verifies the signature recovers to the transaction sender and checks that `expiresAt` is in the future and no
more than 10 minutes ahead. This binds the payment to the specific airnode and endpoint (signatures can't be reused
across either, nor after expiry), and each `txHash` can be redeemed only once — that on-chain hash is the per-payment
uniqueness key.

## Error responses

| Status | Meaning                                            |
| ------ | -------------------------------------------------- |
| `400`  | Missing or invalid parameters                      |
| `401`  | Missing or invalid API key                         |
| `402`  | Payment required (x402 — includes payment details) |
| `404`  | Unknown endpoint ID                                |
| `413`  | Request body too large (> 64KB)                    |
| `415`  | Content-Type must be application/json              |
| `429`  | Too many requests (rate limit exceeded)            |
| `502`  | Upstream API error or internal processing failure  |

## Health check

```bash
curl http://airnode.example.com/health
```

Returns the airnode address and version. Use this to verify the server is running and to discover the airnode address
for signature verification.
