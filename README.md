# Airnode v2

> **⚠️ EXPERIMENTAL — DO NOT USE IN PRODUCTION ⚠️**
>
> This project is under active development. The code has **not been audited**. The contracts, signature formats, and
> APIs are subject to breaking changes without notice. **Do not use this software for production workloads, mainnet
> deployments, or any system where security or financial loss is a concern.**

An HTTP server that signs API responses. API providers run it alongside their existing APIs. Clients receive signed data
and can optionally submit it on-chain.

## What it does

```
Client → HTTP request → Airnode → upstream API → sign response → HTTP response
```

The airnode never touches the chain. It calls upstream APIs, signs the responses with the operator's private key
(EIP-191), and returns the signed data. Clients can verify signatures off-chain or submit them to on-chain contracts.

Two delivery paths:

- **Pull** — client sends `POST /endpoints/{endpointId}`, gets a signed response back immediately
- **Push** — server calls APIs on a timer, stores signed data, relayers poll `GET /beacons/{beaconId}` and push on-chain

## Prerequisites

| Tool                                  | Version | Install                                                     |
| ------------------------------------- | ------- | ----------------------------------------------------------- |
| [Bun](https://bun.sh)                 | latest  | `curl -fsSL https://bun.sh/install \| bash`                 |
| [Foundry](https://book.getfoundry.sh) | >= 1.0  | `curl -L https://foundry.paradigm.xyz \| bash && foundryup` |
| [uv](https://docs.astral.sh/uv/)      | latest  | `curl -LsSf https://astral.sh/uv/install.sh \| sh`          |

Python tools (Vyper, Slither, Halmos) are installed via [uv](https://docs.astral.sh/uv/):

```bash
uv tool install vyper
uv tool install slither-analyzer
uv tool install halmos
```

## Quick start

```bash
bun install
bun src/cli/index.ts generate-key
cp examples/configs/minimal/config.yaml config.yaml
cp examples/configs/minimal/.env.example .env
# Edit .env with your generated private key
bun run dev
```

Test it:

```bash
curl http://localhost:3000/health
```

## Scripts

| Script                     | Description                              |
| -------------------------- | ---------------------------------------- |
| `bun run dev`              | Start the server with `--watch`          |
| `bun test`                 | Run unit tests (src/)                    |
| `bun run test:integration` | Run integration tests (sequential)       |
| `bun run test:contracts`   | Run contract tests (Foundry)             |
| `bun run fmt`              | Format (Prettier) and lint-fix (ESLint)  |
| `bun run lint`             | Check formatting and linting             |
| `bun run lint:slither`     | Run Slither static analysis on contracts |

## Build

Compile to a standalone binary:

```bash
bun run build:osx        # macOS ARM64
bun run build:linux-x64  # Linux x86_64

./dist/airnode start                          # Uses config.yaml + .env
./dist/airnode start -c /path/to/config.yaml  # Custom config path
```

## Project structure

```
src/
  cli/            CLI entry point and commands
  config/         Zod schema, YAML parser, validator, env interpolation
  api/            HTTP call building and response processing
  server.ts       Bun.serve HTTP server (routes, CORS, rate limiting)
  pipeline.ts     Request processing pipeline (auth → validate → cache → API call → sign)
  push.ts         Background push loop and beacon store
  auth.ts         Client-facing authentication (free / apiKey)
  cache.ts        In-memory TTL response cache with periodic sweep
  sign.ts         EIP-191 signing, request ID and beacon ID derivation
  endpoint.ts     Specification-bound endpoint ID derivation
  plugins.ts      Plugin loader, hook registry, budget tracking
  identity.ts     DNS identity verification (ERC-7529)
  logger.ts       Structured logger with AsyncLocalStorage context
  types.ts        Shared Zod-inferred types
contracts/        Vyper contracts and Foundry tests
examples/
  configs/        Reference configurations (complete + minimal)
  plugins/        Example plugins (heartbeat, logger, slack-alerts, encrypted-channel)
integration/      Integration tests (22 scenario files)
book/             Documentation site (Docusaurus)
```

## Contracts

Two Vyper 0.4+ contracts targeting the **prague** EVM version:

| Contract             | Purpose                                               |
| -------------------- | ----------------------------------------------------- |
| `AirnodeVerifier.vy` | Verify signature, prevent replay, forward to callback |
| `AirnodeDataFeed.vy` | Verify signature, store latest value, serve reads     |

Both use the same signature: `keccak256(encodePacked(endpointId, timestamp, data))` with EIP-191 personal sign.

See [`contracts/README.md`](contracts/README.md) for architecture docs, consumer integration examples, and the full test
suite.

### Contract testing

```bash
bun run test:contracts                                       # Unit + invariant tests
halmos --contract AirnodeVerifierSymbolicTest                 # Symbolic execution
halmos --contract AirnodeDataFeedSymbolicTest
bun run lint:slither                                         # Static analysis
```

## Configuration

Config is YAML with 4 sections: `version`, `server`, `settings`, `apis`.

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

See [`examples/configs/complete/config.yaml`](examples/configs/complete/config.yaml) for a full reference. Secrets use
`${ENV_VAR}` interpolation — Bun loads `.env` automatically.

## Documentation

```bash
bun run book:start   # Local dev server
bun run book:build   # Production build
```

## License

MIT
