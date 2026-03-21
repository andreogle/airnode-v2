---
slug: /cli
sidebar_position: 10
---

# CLI Reference

## Usage

```bash
airnode <command> [options]
```

During development:

```bash
bun airnode <command> [options]
```

## `airnode start`

Start the HTTP server. Listens for requests and processes them through the pipeline.

```bash
airnode start [options]
```

| Option            | Alias | Default       | Description                  |
| ----------------- | ----- | ------------- | ---------------------------- |
| `--config <path>` | `-c`  | `config.yaml` | Path to the config file      |
| `--env <path>`    | `-e`  | `.env`        | Path to the environment file |

```bash
airnode start -c config.yaml -e .env.production
```

Shut down gracefully with `Ctrl+C` (`SIGINT`) or `SIGTERM`.

## `airnode cache-server`

Start the cache server for signed beacon data. See [Cache Server](/docs/operators/cache-server) for full documentation.

```bash
airnode cache-server [options]
```

| Option            | Alias | Default             | Description                  |
| ----------------- | ----- | ------------------- | ---------------------------- |
| `--config <path>` | `-c`  | `cache-server.yaml` | Path to the config file      |
| `--env <path>`    | `-e`  | `.env`              | Path to the environment file |

```bash
airnode cache-server -c cache-server.yaml -e .env.production
```

No `AIRNODE_PRIVATE_KEY` is needed — the cache server verifies signatures but does not sign.

## `airnode config validate`

Validate a config file without starting the server. Checks YAML syntax, schema validation, and cross-field consistency.

```bash
airnode config validate -c <path> [options]
```

| Option            | Alias | Description                                      |
| ----------------- | ----- | ------------------------------------------------ |
| `--config <path>` | `-c`  | Path to the config file (required)               |
| `--interpolate`   |       | Resolve `${VAR}` references from the environment |

```bash
airnode config validate -c examples/configs/complete/config.yaml
airnode config validate -c config.yaml --interpolate
```

## `airnode generate-key`

Generate a new Ethereum private key and display the corresponding address. Use this as `AIRNODE_PRIVATE_KEY` in your
`.env` file.

```bash
airnode generate-key
```

No options. Outputs the private key and address.

## `airnode address`

Derive and display the airnode address from the `AIRNODE_PRIVATE_KEY` environment variable. Useful for verifying which
address your node will use without starting it.

```bash
airnode address
```

No options. Requires `AIRNODE_PRIVATE_KEY` in the environment.

## `airnode identity show`

Display the DNS TXT record an operator should set to prove domain ownership via ERC-7529.

```bash
airnode identity show --domain <domain> [options]
```

| Option              | Alias | Default | Description                 |
| ------------------- | ----- | ------- | --------------------------- |
| `--domain <domain>` | `-d`  | --      | Domain name to associate    |
| `--chain-id <id>`   |       | `1`     | Chain ID for the TXT record |

Requires `AIRNODE_PRIVATE_KEY` in the environment.

```bash
airnode identity show --domain api.coingecko.com
airnode identity show --domain api.coingecko.com --chain-id 137
```

## `airnode identity verify`

Verify that a domain's DNS TXT record contains the expected airnode address(es).

```bash
airnode identity verify --address <address...> --domain <domain> [options]
```

| Option                   | Alias | Default | Description                                                 |
| ------------------------ | ----- | ------- | ----------------------------------------------------------- |
| `--address <address...>` | `-a`  | --      | Airnode address(es) to verify (repeatable, comma-separated) |
| `--domain <domain>`      | `-d`  | --      | Domain name to check                                        |
| `--chain-id <id>`        |       | `1`     | Chain ID for the TXT record                                 |

```bash
# Single address
airnode identity verify -a 0xAbC123... -d api.coingecko.com

# Multiple addresses
airnode identity verify -a 0xAbC123... -a 0xDef456... -d api.coingecko.com
```

Exits with code 0 when all addresses are verified, 1 if any are missing.

## Environment variables

| Variable              | Description                                           |
| --------------------- | ----------------------------------------------------- |
| `AIRNODE_PRIVATE_KEY` | The airnode's private key (hex, with `0x` prefix)     |
| `LOG_FORMAT`          | Log format: `text` (default) or `json`                |
| `LOG_LEVEL`           | Log level: `debug`, `info` (default), `warn`, `error` |

Additional environment variables referenced in the config via `${VAR_NAME}` are loaded automatically from the `.env`
file by Bun.
