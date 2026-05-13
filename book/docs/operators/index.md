---
slug: /operators
sidebar_position: 1
sidebar_label: Getting Started
---

# Getting Started

Set up and run an Airnode in under 5 minutes.

## Who should run an Airnode

Airnode is designed for **API providers** to serve their own data on-chain. You should be the API provider or an
authorized representative of the API provider. This is what makes Airnode a first-party oracle — the entity that
controls the data source also controls the signing key.

If you are not the API provider, the trust properties change fundamentally. Consumers cannot verify that you are
honestly relaying data from the upstream API, and DNS identity verification will only prove your domain — not the API
provider's. See the [Trust Model](/docs/security/trust-model) for details.

## 1. Generate a key

```bash
airnode generate-mnemonic
```

This outputs a BIP-39 mnemonic and its corresponding Ethereum address. The address is your Airnode's on-chain identity.
(`airnode address` re-derives it later from `AIRNODE_MNEMONIC` or `AIRNODE_PRIVATE_KEY`.)

## 2. Create config.yaml

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
  - name: MyAPI
    url: https://api.example.com
    endpoints:
      - name: getPrice
        path: /price
        method: GET
        parameters:
          - name: symbol
            in: query
            required: true
        encoding:
          type: int256
          path: $.price
          times: '1e18'
```

See the [Config Reference](/docs/config) for all available fields.

## 3. Create .env

```bash
AIRNODE_MNEMONIC=your twelve word mnemonic ...  # from step 1 (or AIRNODE_PRIVATE_KEY=0x...)
```

Add any environment variables referenced in your config (e.g., `${COINGECKO_API_KEY}`).

## 4. Validate

```bash
airnode config validate -c config.yaml
```

Fix any schema errors before starting.

## 5. Start

```bash
airnode start
```

The server starts and logs the airnode address, port, and number of endpoints.

## 6. Test

```bash
curl http://localhost:3000/health
```

Expected response:

```json
{
  "status": "ok",
  "airnode": "0x..."
}
```

## Environment variables

| Variable              | Required | Description                                                                        |
| --------------------- | -------- | ---------------------------------------------------------------------------------- |
| `AIRNODE_MNEMONIC`    | Yes\*    | BIP-39 mnemonic. Signs all responses. Takes precedence over `AIRNODE_PRIVATE_KEY`. |
| `AIRNODE_PRIVATE_KEY` | Yes\*    | Hex-encoded private key (with `0x` prefix). Signs all responses.                   |
| `LOG_FORMAT`          | No       | `text` (default) or `json`.                                                        |
| `LOG_LEVEL`           | No       | `debug`, `info` (default), `warn`, or `error`.                                     |

\* Exactly one of `AIRNODE_MNEMONIC` or `AIRNODE_PRIVATE_KEY` is required.

Bun automatically loads `.env` files from the working directory.

## CLI flags

| Flag                  | Default       | Description              |
| --------------------- | ------------- | ------------------------ |
| `-c, --config <path>` | `config.yaml` | Path to the config file. |
| `-e, --env <path>`    | `.env`        | Path to the .env file.   |

## Next steps

- [Deployment](/docs/operators/deployment) -- run in production with systemd, Docker, or Docker Compose
- [Config Reference](/docs/config) -- full configuration documentation
- [Plugins](/docs/plugins) -- extend Airnode with custom hooks
