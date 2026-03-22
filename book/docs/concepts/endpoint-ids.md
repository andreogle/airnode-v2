---
slug: /concepts/endpoint-ids
sidebar_position: 3
---

# Endpoint IDs

Endpoint IDs are deterministic hashes of the full API specification. They are not names, not UUIDs, not
auto-incrementing counters. The ID is derived from what the endpoint does -- its URL, path, method, parameters, and
encoding -- so two operators calling the same API with the same specification produce the same endpoint ID.

## Derivation

The endpoint ID is the keccak256 hash of a pipe-delimited canonical string:

```
endpointId = keccak256(url | path | method | sorted parameters | encoding spec)
```

Concretely, for an endpoint configured as:

```yaml
apis:
  - name: CoinGecko
    url: https://api.coingecko.com/api/v3
    endpoints:
      - name: coinPrice
        path: /simple/price
        method: GET
        parameters:
          - name: vs_currencies
            in: query
            fixed: usd
          - name: ids
            in: query
            required: true
        encoding:
          type: int256
          path: $.ethereum.usd
          times: '1e18'
```

The canonical string is:

```
https://api.coingecko.com/api/v3|/simple/price|GET|ids,vs_currencies=usd|int256|$.ethereum.usd|1e18
```

And the endpoint ID is `keccak256` of that string encoded as hex bytes.

## What Is Included

These fields are part of the hash:

| Field                 | Example                            | Why                                                            |
| --------------------- | ---------------------------------- | -------------------------------------------------------------- |
| `api.url`             | `https://api.coingecko.com/api/v3` | Different APIs produce different endpoint IDs                  |
| `endpoint.path`       | `/simple/price`                    | Different paths on the same API are different endpoints        |
| `endpoint.method`     | `GET`                              | A GET and POST to the same path are different operations       |
| Non-secret parameters | `ids,vs_currencies=usd`            | Parameters define what data is being requested                 |
| `encoding.type`       | `int256`                           | Different encodings of the same data produce different outputs |
| `encoding.path`       | `$.ethereum.usd`                   | Extracting different fields produces different data            |
| `encoding.times`      | `1e18`                             | Different multipliers produce different values                 |

### Parameter rules

Parameters are sorted alphabetically by name and formatted as:

- **Client-provided** (no `fixed` value): just the name, e.g. `ids`
- **Fixed value**: name=value, e.g. `vs_currencies=usd`
- **Secret parameters** (`secret: true` or `fixed` value starting with `${`): excluded entirely

This means adding a secret API key header to the config does not change the endpoint ID. Two operators using the same
API -- one with a free key, one with a paid key -- get the same endpoint ID as long as the public specification matches.

## What Is Excluded

These fields do not affect the endpoint ID:

| Field                          | Why excluded                                                       |
| ------------------------------ | ------------------------------------------------------------------ |
| `endpoint.name`                | Names are for human readability, not identity                      |
| `api.headers`                  | Headers often contain secrets (API keys, auth tokens)              |
| `api.auth`                     | Client-facing auth is an operator choice, not a data specification |
| `api.timeout`                  | Operational config, not data specification                         |
| `api.cache` / `endpoint.cache` | Caching is an optimization, not a data property                    |
| `endpoint.push`                | Push interval is operational, not data-related                     |
| Secret parameters              | Parameters marked `secret: true` or with `${ENV_VAR}` fixed values |
| Default values                 | Defaults are convenience for clients, not part of the spec         |

## Why This Design

### Cross-operator comparability

When two independent first-party operators serve the same API endpoint with the same parameters and encoding, they
produce the same endpoint ID. On-chain contracts can verify that data from different airnodes refers to the same
underlying data point without trusting a centralized registry.

This is how beacon aggregation works: multiple first-party airnodes produce beacons for the same endpoint ID, and a data
feed contract aggregates them into a single value. The endpoint ID is the common key.

Note that a matching endpoint ID proves two operators committed to the same API specification — it does not prove they
are actually calling it. With first-party airnodes (where the API provider operates the node), this is inherently
trustworthy. With third-party operators, a matching endpoint ID provides weaker guarantees because the operator could
fabricate data while claiming to serve the specified API.

### TLS proof verification

The canonical string used to derive the endpoint ID matches the information that would be present in a TLS proof of the
HTTP request. A future verifier can check that:

1. The API URL and path in the TLS proof match the endpoint specification.
2. The query parameters in the TLS proof match the non-secret parameters.
3. The endpoint ID hash is consistent with the observed request.

This is why secret parameters are excluded -- they would appear in the TLS transcript but should not be part of the
public identity.

### No registry

Endpoint IDs do not require registration, coordination, or a central authority. Any operator can derive the ID locally
from the config. If two operators arrive at the same ID, they are by definition serving the same data specification.

## Computing an Endpoint ID

The CLI prints endpoint IDs for every endpoint when you validate a config:

```bash
airnode config validate -c config.yaml
```

You can also derive the ID programmatically:

```typescript
import { keccak256, toHex } from 'viem';

const canonical = [
  'https://api.coingecko.com/api/v3',
  '/simple/price',
  'GET',
  'ids,vs_currencies=usd',
  'int256|$.ethereum.usd|1e18',
].join('|');

const endpointId = keccak256(toHex(canonical));
```
