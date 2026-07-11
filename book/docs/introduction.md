---
slug: /
sidebar_position: 1
---

# Airnode v2

Airnode is an HTTP server for API providers. It receives a request, calls an upstream API, and signs the response with
an EIP-191 key. A client can verify the signature off-chain or submit it to a verifier contract.

Airnode does not scan blockchains or submit fulfillment transactions. The operator runs it next to an existing API and
remains responsible for the API, the Airnode service, and the signing key.

## Who it is for

### API providers

Airnode lets an API provider offer signed responses without changing the upstream API. The provider chooses which routes
to expose and how clients access them:

- `free` allows public access.
- `apiKey` restricts access to configured client keys.
- `x402` charges for each request using the payment flow described in the
  [configuration reference](/docs/config/apis#x402-http-native-payment).

### Consumers

A consumer receives the data together with an Airnode address, endpoint ID, timestamp, and signature. The signature
proves that the holder of the Airnode key signed that response. It does not, by itself, prove who operates the Airnode
or where the data came from.

Before trusting a response, consumers should:

1. Confirm the Airnode address through [DNS identity verification](/docs/security/identity-verification).
2. Understand what the [endpoint ID](/docs/concepts/endpoint-ids) commits to.
3. Verify the signature and apply a freshness check.
4. Decide whether the operator and upstream API are suitable for the use case.

See the [trust model](/docs/security/trust-model) for the full boundary.

## How a request works

```text
Client ──POST──> Airnode ──HTTP──> Upstream API
                    |                    |
                    |<── JSON response ──┘
                    |
                    ├─ Encode, if configured
                    ├─ Encrypt, if configured
                    ├─ Sign
                    └─ Request a separate TLS proof, if configured
                    |
                    v
              Signed response
```

1. A client sends `POST /endpoints/{endpointId}` with request parameters.
2. Airnode resolves the endpoint, authenticates the client, and validates the parameters.
3. Airnode calls the upstream API.
4. It returns raw JSON or ABI-encodes a configured value.
5. It optionally encrypts the encoded value.
6. It signs the result.
7. It may request a separate TLS proof. Proof failure does not fail the Airnode response.

Endpoints can also use `async` mode or return the result in a single Server-Sent Events frame. See
[Requests and responses](/docs/concepts/request-response).

## What endpoint IDs mean

An endpoint ID is a hash of the configured API URL, path, method, parameter rules, encoding, and encryption settings. If
one of those fields changes, the ID changes.

The ID commits to the published configuration. It does not prove that the running process used that configuration for a
particular request. See [Endpoint IDs](/docs/concepts/endpoint-ids).

## Run from source

Airnode v2 is currently an alpha and has no published release binaries. To run it from this repository, install
[Bun](https://bun.sh/) and then run:

```bash
git clone https://github.com/andreogle/airnode-v2.git
cd airnode-v2
bun install
bun run airnode generate-mnemonic
```

Save either the mnemonic or a private key in `.env`:

```bash
AIRNODE_MNEMONIC=your twelve word mnemonic ...
```

Create `config.yaml`:

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

Validate the config and copy the printed endpoint ID:

```bash
bun run airnode config validate -c config.yaml
```

Start the server:

```bash
bun run airnode start -c config.yaml
```

Make a request:

```bash
curl -X POST http://localhost:3000/endpoints/{endpointId} \
  -H "Content-Type: application/json" \
  -d '{"parameters":{"ids":"ethereum","vs_currencies":"usd"}}'
```

Check the service:

```bash
curl http://localhost:3000/health
```

## Routes

| Method | Path                      | Purpose                                   |
| ------ | ------------------------- | ----------------------------------------- |
| `POST` | `/endpoints/{endpointId}` | Call an endpoint                          |
| `GET`  | `/requests/{requestId}`   | Poll an async request                     |
| `GET`  | `/health`                 | Check status and read the Airnode address |

## Next steps

- [Run an Airnode](/docs/operators)
- [Call an Airnode](/docs/consumers/getting-started)
- [Understand the trust model](/docs/security/trust-model)
