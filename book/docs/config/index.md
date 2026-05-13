---
slug: /config
sidebar_position: 1
sidebar_label: Overview
---

# Configuration

Airnode is configured with a single YAML file. JSON is also accepted. The file has four top-level sections:

| Section                             | Purpose                                                 |
| ----------------------------------- | ------------------------------------------------------- |
| `version`                           | Must be `'1.0'`. Used for schema validation.            |
| [`server`](/docs/config/server)     | HTTP server port, host, CORS, and rate limiting.        |
| [`settings`](/docs/config/settings) | Global timeout, proof mode, and plugin configuration.   |
| [`apis`](/docs/config/apis)         | Upstream API definitions with endpoints and parameters. |

## Minimal config

```yaml
version: '1.0'

server:
  port: 3000
  rateLimit:
    window: 60000
    max: 100

settings:
  proof: none

apis:
  - name: MockAPI
    url: http://localhost:5123
    endpoints:
      - name: getValue
        path: /value
        encoding:
          type: int256
          path: $.value
```

## Complete config

```yaml
version: '1.0'

server:
  port: 3000
  host: '0.0.0.0'
  cors:
    origins:
      - '*'
  rateLimit:
    window: 60000
    max: 100

settings:
  timeout: 15000
  proof: none # or: { type: reclaim, gatewayUrl: 'http://localhost:5177/v1/prove' }
  plugins:
    - source: ../../plugins/heartbeat.ts
      timeout: 5000

apis:
  - name: CoinGecko
    url: http://localhost:5123
    timeout: 15000
    headers:
      x-cg-pro-api-key: ${COINGECKO_API_KEY}
    auth:
      type: apiKey
      keys:
        - ${CLIENT_API_KEY}
    cache:
      maxAge: 30000
    endpoints:
      - name: coinPrice
        path: /simple/price
        method: GET
        parameters:
          - name: ids
            in: query
            required: true
            description: Coin ID (e.g. ethereum, bitcoin)
          - name: vs_currencies
            in: query
            default: usd
        encoding:
          type: int256
          path: $.ethereum.usd
          times: '1e18'
        cache:
          maxAge: 30000
        description: Get the current price of a coin

      - name: coinMarketData
        path: /coins/{coinId}
        method: GET
        parameters:
          - name: coinId
            in: path
            required: true
          - name: localization
            in: query
            fixed: 'false'
          - name: tickers
            in: query
            fixed: 'false'
        encoding:
          type: int256
          path: $.market_data.current_price.usd
          times: '1e18'

      - name: coinPriceMulti
        path: /simple/price
        method: GET
        parameters:
          - name: ids
            in: query
            required: true
          - name: vs_currencies
            in: query
            fixed: usd
          - name: include_24hr_vol
            in: query
            fixed: 'true'
        encoding:
          type: int256,uint256
          path: $.ethereum.usd,$.ethereum.usd_24h_vol
          times: '1e18,1e18'
        description: Get price and 24h volume in a single response

      - name: coinPriceRaw
        path: /simple/price
        method: GET
        parameters:
          - name: ids
            in: query
            required: true
          - name: vs_currencies
            in: query
            required: true
        description: Raw JSON response — no ABI encoding

  - name: WeatherAPI
    url: http://localhost:5123
    headers:
      x-weather-key: ${WEATHER_API_KEY}
    auth:
      type: free
    endpoints:
      - name: currentTemp
        path: /current.json
        method: GET
        parameters:
          - name: q
            in: query
            required: true
            description: Location query (city name, lat/lon, IP, etc.)
        encoding:
          type: int256
          path: $.current.temp_c
          times: '100'

  - name: RandomAPI
    url: http://localhost:5123
    timeout: 30000
    headers:
      Authorization: Bearer ${RANDOM_ORG_TOKEN}
      Content-Type: application/json
    endpoints:
      - name: generateInteger
        path: /json-rpc/4/invoke
        method: POST
        parameters:
          - name: jsonrpc
            in: body
            fixed: '2.0'
          - name: method
            in: body
            fixed: generateIntegers
          - name: min
            in: body
            default: 0
          - name: max
            in: body
            default: 100
        encoding:
          type: uint256
          path: $.result.random.data[0]
```

## Section ordering

Sections must appear in this order: `version`, `server`, `settings`, `apis`. This convention keeps configs readable and
consistent across deployments.

## Environment variable interpolation

Use `${VAR_NAME}` syntax to reference environment variables. This is the recommended way to handle secrets:

```yaml
headers:
  x-cg-pro-api-key: ${COINGECKO_API_KEY}
auth:
  type: apiKey
  keys:
    - ${CLIENT_API_KEY}
```

When the config is loaded, every `${VAR_NAME}` token is replaced with the corresponding environment variable. If a
referenced variable is not set, the node exits with an error identifying the missing variable.

Bun automatically loads `.env` files from the working directory, so you do not need a dotenv library.

## Inheritance

Auth and cache settings inherit from the API level to the endpoint level. You can set `auth` or `cache` on the API and
all endpoints under it will use those settings.

Endpoint-level settings **replace** the API-level setting entirely -- they do not merge. If an endpoint defines its own
`auth`, the API-level `auth` is ignored for that endpoint. The same applies to `cache`.

```yaml
apis:
  - name: MyAPI
    url: https://api.example.com
    auth:
      type: apiKey
      keys:
        - ${KEY}
    cache:
      maxAge: 30000
    endpoints:
      # Inherits auth (apiKey) and cache (30s) from API level
      - name: default
        path: /data

      # Overrides auth to free, still inherits cache (30s)
      - name: public
        path: /public
        auth:
          type: free

      # Overrides cache, still inherits auth (apiKey)
      - name: realtime
        path: /live
        cache:
          maxAge: 5000
```

## Validation

Validate your config before deploying:

```bash
airnode config validate -c config.yaml
```

The validator checks:

1. **YAML syntax** -- is the file valid YAML?
2. **Schema validation** -- does the structure match the Zod v4 schema? Errors include the exact path and expected type.
