# Airnode v2

> **This project is under active development. The code has not been audited. Signature formats, APIs, and contracts are
> subject to breaking changes. Do not use for production workloads or mainnet deployments.**

Sign API responses with your private key and serve them over HTTP. Clients verify signatures off-chain or submit them to
on-chain contracts. No chain scanning, no database, no coordinator — a stateless HTTP service that sits in front of your
existing API.

## How it works

```
Client ──POST──▶ Airnode ──HTTP──▶ Upstream API
                    │                    │
                    │◀───JSON response───┘
                    │
                    ├─ Extract value (JSONPath)
                    ├─ ABI-encode (int256, uint256, ...)
                    ├─ Sign (EIP-191)
                    │
                    ▼
              Signed response ──▶ verify off-chain or submit on-chain
```

## Quick start

```bash
bun install
bun airnode generate-mnemonic           # prints private key + address
cp examples/configs/minimal/config.yaml config.yaml
cp examples/configs/minimal/.env.example .env
# paste your private key into .env
bun run dev
```

Make a request (replace `{endpointId}` with the ID printed at startup):

```bash
curl -X POST http://localhost:3000/endpoints/{endpointId} \
  -H "Content-Type: application/json" \
  -d '{"parameters":{"ids":"ethereum","vs_currencies":"usd"}}'
```

```json
{
  "airnode": "0x...",
  "endpointId": "0x...",
  "timestamp": 1711234567,
  "data": "0x0000000000000000000000000000000000000000000000a2a15d09519be00000",
  "signature": "0x..."
}
```

## What you can do

- **Sign any API response** with your key — turn untrusted data into a verifiable attestation
- **Serve data to smart contracts** — ABI-encoded responses ready for on-chain submission
- **Monetize access** — API keys or pay-per-request via x402
- **Control encoding at request time** — clients pass `_type`, `_path`, `_times` to choose what to extract
- **Extend with plugins** — hooks at every pipeline stage for custom logic

## Routes

| Method | Path                      | Description                      |
| ------ | ------------------------- | -------------------------------- |
| `POST` | `/endpoints/{endpointId}` | Call an endpoint with parameters |
| `GET`  | `/requests/{requestId}`   | Poll an async request for status |
| `GET`  | `/health`                 | Version and airnode address      |

## Configuration

YAML config with `${ENV_VAR}` interpolation. Bun loads `.env` automatically.

```yaml
version: '1.0'

server:
  port: 3000

settings:
  proof: none

apis:
  - name: CoinGecko
    url: https://api.coingecko.com/api/v3
    headers:
      x-cg-pro-api-key: ${COINGECKO_API_KEY}
    auth:
      type: apiKey
      keys:
        - ${CLIENT_API_KEY}
    endpoints:
      - name: price
        path: /simple/price
        parameters:
          - name: ids
            in: query
            required: true
        encoding:
          type: int256
          path: $.bitcoin.usd
          times: '1e18'
```

See [`examples/configs/complete/config.yaml`](examples/configs/complete/config.yaml) for auth methods, caching,
multi-value encoding, and all available fields.

## Contracts

One Solidity contract (EVM target: `prague`):

| Contract              | Purpose                                               |
| --------------------- | ----------------------------------------------------- |
| `AirnodeVerifier.sol` | Verify signature, prevent replay, forward to callback |

Verifies `keccak256(encodePacked(endpointId, timestamp, data))` with EIP-191 personal sign. See
[`contracts/README.md`](contracts/README.md) for integration examples.

## Development

### Prerequisites

| Tool                                  | Install                                                     |
| ------------------------------------- | ----------------------------------------------------------- |
| [Bun](https://bun.sh)                 | `curl -fsSL https://bun.sh/install \| bash`                 |
| [Foundry](https://book.getfoundry.sh) | `curl -L https://foundry.paradigm.xyz \| bash && foundryup` |

### Scripts

| Script                     | Description                              |
| -------------------------- | ---------------------------------------- |
| `bun run dev`              | Start the server with `--watch`          |
| `bun test`                 | Run unit tests (src/)                    |
| `bun run test:integration` | Run integration tests (sequential)       |
| `bun run test:contracts`   | Run contract tests (Foundry)             |
| `bun run fmt`              | Format (Prettier) and lint-fix (ESLint)  |
| `bun run lint`             | Check formatting and linting             |
| `bun run lint:slither`     | Run Slither static analysis on contracts |

### Build

Compile to a standalone binary:

```bash
bun run build:osx        # macOS ARM64
bun run build:linux-x64  # Linux x86_64

./dist/airnode start -c config.yaml
```

### Project structure

```
src/
  cli/            CLI commands (start, generate-mnemonic, etc.)
  config/         Zod schema, YAML parser, env interpolation
  api/            Upstream API calls and response processing
  server.ts       Bun.serve HTTP server
  pipeline.ts     Request pipeline (auth → validate → cache → API → encode → sign)
  auth.ts         Authentication (free, apiKey, x402)
  sign.ts         EIP-191 signing
  endpoint.ts     Specification-bound endpoint ID derivation
  plugins.ts      Plugin hooks and budget tracking
contracts/        Solidity contracts and Foundry tests
examples/
  configs/        Reference configs (complete, minimal)
  plugins/        Example plugins (heartbeat, logger, slack-alerts)
book/             Documentation site (Docusaurus)
```

## Documentation

Full docs at the [documentation site](book/). Run locally:

```bash
bun run book:start
```

## License

MIT
