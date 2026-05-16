---
slug: /
sidebar_position: 1
---

# Airnode v2

Airnode is an HTTP server that receives requests from clients, calls upstream APIs, signs the responses with the API
provider's private key (EIP-191), and returns the signed data. Clients can verify the signature off-chain or submit the
signed response on-chain. There is no chain scanning, no coordinator cycle, no database -- Airnode is a stateless HTTP
service that API providers run alongside their existing APIs.

## Why Run an Airnode

If you operate an API, running an Airnode lets you serve your data to smart contracts and crypto-native clients without
changing your existing infrastructure. Your API stays exactly as it is — Airnode sits in front of it as a signing proxy.

- **Monetize your API on-chain.** Smart contracts can't call HTTP APIs directly. Airnode bridges this gap. Developers
  pay per-request via API keys or x402 HTTP-native payments — you choose the model.
- **No blockchain expertise required.** You don't run a node, manage wallets, or write smart contracts. Airnode is a
  stateless HTTP server that signs responses. The on-chain verification contract is already deployed.
- **Your data, your key.** Every response is signed with your private key, creating a verifiable attestation: "this API
  provider, at this time, received this data from this API." Your reputation is tied to your signature.
- **Zero infrastructure change.** Airnode calls your existing API endpoints. You don't need to modify your API, add new
  routes, or change your data format. Point Airnode at your API URL and configure which endpoints to serve.

## Why Request Data from an Airnode

If you're building a smart contract, dApp, or AI agent that needs real-world data, Airnode provides it with
cryptographic guarantees.

- **First-party data.** The API provider runs the Airnode and signs the data directly. No intermediary chain of oracles
  repackaging data — the signature traces back to the source. Verify that the airnode is operated by the API provider
  using [DNS identity verification](/docs/security/identity-verification) (ERC-7529) before trusting its data.
- **Verifiable off-chain and on-chain.** Every response includes an EIP-191 signature. Verify it locally in your
  application or submit it to an on-chain verifier contract. The same signature works in both contexts.
- **Standard HTTP interface.** No proprietary SDKs or oracle-specific protocols. Send a `POST` request, get signed JSON
  back. Any HTTP client works — `curl`, `fetch`, Axios, or your smart contract's off-chain component.
- **Flexible encoding.** Get raw JSON for off-chain use, or ABI-encoded data ready for on-chain submission. You can even
  choose the encoding at request time with `_type`, `_path`, and `_times` parameters.
- **Multiple access models.** Free endpoints for public data, API keys for authenticated access, or pay-per-request via
  x402. Use whatever fits your use case.
- **Aggregation across providers.** Each API provider runs their own airnode for their own API. Consumers can aggregate
  signed data from several first-party airnodes — for example, combining BTC/USD from multiple exchanges into an
  on-chain average or median — without any coordination layer in between.

## Core Flow

Every request follows the same path:

```
Client ──POST──▶ Airnode ──HTTP──▶ Upstream API
                    │                    │
                    │◀───JSON response───┘
                    │
                    ├─ Encode (ABI or raw JSON)
                    ├─ Encrypt (FHE — optional)
                    ├─ Sign (EIP-191)
                    ├─ TLS proof (Reclaim — optional)
                    │
                    ▼
              Signed response
```

1. A client sends a `POST /endpoints/{endpointId}` request with parameters.
2. Airnode resolves the endpoint, authenticates the client, and validates parameters.
3. Airnode calls the upstream API and receives a JSON response.
4. If the endpoint has encoding configured, Airnode ABI-encodes the response. Otherwise, the raw JSON is returned.
5. If the endpoint has `encrypt` configured, the encoded value is replaced with an FHE ciphertext.
6. Airnode signs the result with the operator's private key.
7. If TLS proofs are enabled, Airnode requests an attestation of the upstream call (non-fatal — a failure just omits the
   proof).
8. The signed response is returned to the client.

Endpoints can also run in `async` mode (returns `202` with a `pollUrl`; the result is fetched later from
`GET /requests/{requestId}`) or `stream` mode (the signed result is wrapped in a single Server-Sent Events frame). See
[Request and Response](/docs/concepts/request-response).

## Endpoint IDs

Endpoint IDs are deterministic hashes of the API specification -- the URL, path, method, non-secret parameters, encoding
configuration, and encryption configuration. The ID binds the airnode's signature to the exact API spec the operator
committed to, so a consumer hard-coding an endpoint ID locks in the upstream URL, parameters, and encoding rules. Any
change to the spec produces a different ID, which on-chain consumers can detect immediately.

```
endpointId = keccak256(url | path | method | sorted parameters | encoding spec | encrypt spec)
```

See [Endpoint IDs](/docs/concepts/endpoint-ids) for the full derivation.

## Quick Start

### 1. Install

Download the `airnode` binary for your platform from the
[latest release](https://github.com/api3dao/airnode-v2/releases/latest) and place it on your `PATH`.

### 2. Generate a key

```bash
airnode generate-mnemonic
```

This prints a new BIP-39 mnemonic and its corresponding airnode address. Save the mnemonic to a `.env` file:

```bash
echo 'AIRNODE_MNEMONIC=your twelve word mnemonic ...' > .env
```

(`AIRNODE_PRIVATE_KEY=0x...` also works; the mnemonic takes precedence if both are set.)

### 3. Create a config

Create `config.yaml` in the project root:

```yaml
version: '1.0'

server:
  port: 3000
  rateLimit:
    window: 60000
    max: 100
    x402:
      window: 60000
      max: 30

settings:
  maxConcurrentApiCalls: 50
  proof: none

apis:
  - name: CoinGecko
    url: https://api.coingecko.com/api/v3
    auth:
      type: free
    endpoints:
      - name: coinPrice
        path: /simple/price
        parameters:
          - name: ids
            in: query
            required: true
          - name: vs_currencies
            in: query
            default: usd
        encoding:
          type: int256
          path: $.ethereum.usd
          times: '1e18'
```

### 4. Start the server

```bash
airnode start -c config.yaml
```

Airnode logs the server address and all registered endpoint IDs on startup.

### 5. Make a request

```bash
curl -X POST http://localhost:3000/endpoints/{endpointId} \
  -H "Content-Type: application/json" \
  -d '{"parameters":{"ids":"ethereum","vs_currencies":"usd"}}'
```

Replace `{endpointId}` with the endpoint ID printed at startup. The response contains the signed data:

```json
{
  "airnode": "0x...",
  "endpointId": "0x...",
  "timestamp": 1234567890,
  "data": "0x...",
  "signature": "0x..."
}
```

### 6. Check health

```bash
curl http://localhost:3000/health
```

```json
{
  "status": "ok",
  "airnode": "0x..."
}
```

## Routes

| Method | Path                      | Description                             |
| ------ | ------------------------- | --------------------------------------- |
| `POST` | `/endpoints/{endpointId}` | Call an endpoint with parameters        |
| `GET`  | `/requests/{requestId}`   | Poll an async request for its result    |
| `GET`  | `/health`                 | Health check (status + airnode address) |
