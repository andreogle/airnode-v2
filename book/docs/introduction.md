---
slug: /
sidebar_position: 1
---

# Airnode v2

Airnode is an HTTP server that receives requests from clients, calls upstream APIs, signs the responses with the API
provider's private key (EIP-191), and returns the signed data. Clients can verify the signature off-chain or submit the
signed response on-chain. There is no chain scanning, no coordinator cycle, no database -- Airnode is a stateless HTTP
service that API providers run alongside their existing APIs.

## Core Flow

Every request follows the same path:

```
Client ──POST──▶ Airnode ──HTTP──▶ Upstream API
                    │                    │
                    │◀───JSON response───┘
                    │
                    ├─ Encode (ABI or raw JSON)
                    ├─ Sign (EIP-191)
                    │
                    ▼
              Signed response
```

1. A client sends a `POST /endpoints/{endpointId}` request with parameters.
2. Airnode resolves the endpoint, authenticates the client, and validates parameters.
3. Airnode calls the upstream API and receives a JSON response.
4. If the endpoint has encoding configured, Airnode ABI-encodes the response. Otherwise, the raw JSON is returned.
5. Airnode signs the result with the operator's private key.
6. The signed response is returned to the client.

## Two Delivery Paths

Airnode serves data through two models from the same server:

**Pull** -- clients request data on demand. A client sends `POST /endpoints/{endpointId}`, Airnode calls the API, signs,
and responds. One-shot, stateless.

**Push** -- Airnode calls APIs on a background interval, signs the data, and stores it as beacons. Relayers poll
`GET /beacons/{beaconId}` and submit the signed data to on-chain data feed contracts. This powers continuous price feeds
without requiring individual client requests.

Both paths produce the same signed data format. The difference is who initiates the API call.

## Endpoint IDs

Endpoint IDs are deterministic hashes of the API specification -- the URL, path, method, non-secret parameters, and
encoding configuration. Two operators calling the same API endpoint with the same specification produce the same
endpoint ID. This is by design: it enables cross-operator data comparability and future TLS proof verification.

```
endpointId = keccak256(url | path | method | sorted parameters | encoding spec)
```

See [Endpoint IDs](/docs/concepts/endpoint-ids) for the full derivation.

## Quick Start

### 1. Install

Download the `airnode` binary for your platform from the
[latest release](https://github.com/api3dao/airnode-v2/releases/latest) and place it on your `PATH`.

### 2. Generate a key

```bash
airnode generate-key
```

This prints a new private key and its corresponding airnode address. Save the private key to a `.env` file:

```bash
echo 'AIRNODE_PRIVATE_KEY=0x...' > .env
```

### 3. Create a config

Create `config.yaml` in the project root:

```yaml
version: '1.0'

server:
  port: 3000

settings:
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
            required: true
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
  "version": "2.0.0",
  "airnode": "0x..."
}
```

## Routes

| Method | Path                      | Description                                   |
| ------ | ------------------------- | --------------------------------------------- |
| `POST` | `/endpoints/{endpointId}` | Call an endpoint with parameters              |
| `GET`  | `/beacons/{beaconId}`     | Read latest push beacon data                  |
| `GET`  | `/beacons`                | List all available beacons                    |
| `GET`  | `/health`                 | Health check with version and airnode address |
