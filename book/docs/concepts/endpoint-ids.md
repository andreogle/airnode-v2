---
slug: /concepts/endpoint-ids
sidebar_position: 3
---

# Endpoint IDs

An endpoint ID identifies a configured API operation. Airnode derives it from the parts of the configuration that affect
the upstream request or the meaning of the signed data.

Changing one of those fields creates a new ID. Human-readable names, client authentication, caching, and other
operational settings do not affect it.

## Derivation

Airnode hashes this canonical string with Keccak-256:

```text
api URL | path | method | sorted parameter rules | encoding | encryption
```

The encoding and encryption segments are omitted when they are not configured.

For example:

```yaml
apis:
  - name: CoinGecko
    url: https://api.coingecko.com/api/v3
    endpoints:
      - name: coinPrice
        path: /simple/price
        method: GET
        parameters:
          - name: ids
            in: query
            required: true
          - name: vs_currencies
            in: query
            fixed: usd
        encoding:
          type: int256
          path: $.ethereum.usd
          times: '1e18'
```

produces a canonical value like:

```text
https://api.coingecko.com/api/v3|/simple/price|GET|[{"name":"ids","in":"query","required":true,"secret":false},{"name":"vs_currencies","in":"query","required":false,"secret":false,"fixed":"usd"}]|type=int256,path=$.ethereum.usd,times=1e18
```

Parameter rules are sorted by name and location before hashing.

## Included fields

The ID includes:

- API URL
- endpoint path and method
- each parameter's name, location, required flag, and secret marker
- non-secret fixed and default parameter values
- encoding type, JSON path, and multiplier
- FHE ciphertext type and consumer contract, when encryption is configured

This means changing the URL, moving a parameter from a query string to a header, or changing the response encoding
creates a new ID.

## Excluded fields

The ID does not include:

- API or endpoint names
- upstream headers
- secret parameter values
- client authentication
- timeouts and caching
- response mode
- FHE network and relayer settings

These fields are operational or secret. For example, rotating an upstream API key should not change the endpoint ID.

## Secret parameters

A parameter marked `secret: true` remains represented in the parameter list, but its value is omitted. Airnode also
treats a fixed `${ENV_VAR}` value as secret.

Adding or removing a secret parameter changes the ID. Changing only its secret value does not.

## Fixed and client-selected encoding

An encoding field can be fixed by the operator or set to `'*'` so the client supplies it at request time.

```yaml
# Fully fixed
encoding:
  type: int256
  path: $.price
  times: '1e18'

# Client chooses only the path
encoding:
  type: int256
  path: '*'
  times: '1e18'
```

The endpoint ID includes either the fixed value or the literal `*`. A consumer that accepts an ID containing a wildcard
is also accepting that the requester controls that part of the encoding.

Clients fill wildcard fields with reserved request parameters:

| Config value | Request parameter |
| ------------ | ----------------- |
| `type: '*'`  | `_type`           |
| `path: '*'`  | `_path`           |
| `times: '*'` | `_times`          |

Client values cannot override fixed encoding fields. If the endpoint has no `encoding` block, these reserved parameters
do not enable encoding; Airnode returns signed raw JSON instead.

## FHE encryption

An encrypted endpoint adds this shape to the ID:

```text
fhe=euint256,contract=0x...
```

The consumer contract and ciphertext type therefore affect the ID. Relayer and network settings do not.

## What the ID proves

The ID lets a consumer recompute the hash from a published configuration and detect changes to that specification.

It does not prove that:

- the published configuration is the one currently running
- the operator called the configured API for a particular response
- the upstream API returned the signed value

The operator's signature still carries those trust assumptions. A separate [TLS proof](/docs/concepts/proofs) can add
evidence about a gateway's HTTPS request and response matching, subject to the limits described on that page.

## Print endpoint IDs

Validate a config to print every derived endpoint ID:

```bash
airnode config validate -c config.yaml
```

The server also prints registered IDs during startup.
