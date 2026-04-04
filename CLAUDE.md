## Runtime

Default to Bun instead of Node.js.

- `bun <file>` instead of `node` or `ts-node`
- `bun test` instead of `jest` or `vitest`
- `bun install` instead of `npm install` / `yarn install` / `pnpm install`
- `bun run <script>` instead of `npm run` / `yarn run` / `pnpm run`
- `bunx <package>` instead of `npx`
- Bun automatically loads `.env` — don't use dotenv.
- Prefer `Bun.file` over `node:fs` readFile/writeFile.
- Use `node:` prefix for built-in modules without a Bun-native alternative (e.g. `node:async_hooks`).

## Project structure

```
src/
  cli/              CLI entry point (commander.js) and commands
  config/           Schema (Zod v4), parser, validator, env interpolation
  api/              HTTP call building and response processing
  abi-encode.ts     ABI encoding (0x01 + string[] name-value pairs)
  server.ts         Bun.serve HTTP server (routes, CORS, rate limiting)
  pipeline.ts       Request processing pipeline (auth → validate → cache → plugins → API call → encode → sign)
  auth.ts           Client-facing request authentication (free / apiKey)
  cache.ts          In-memory TTL response cache with periodic sweep
  sign.ts           EIP-191 response signing and request ID derivation
  identity.ts       DNS identity verification (ERC-7529) — public API
  endpoint.ts       Endpoint resolution and specification-bound ID derivation
  plugins.ts        Plugin loader, hook registry, budget tracking
  logger.ts         AsyncLocalStorage context, text/json formats
  types.ts          Shared Zod-inferred types
  guards.ts         Type guard utilities
  version.ts        Version from package.json or build-time define
examples/
  configs/          Example YAML configs (must always pass validation)
  plugins/          Example plugins (heartbeat, logger, slack-alerts, encrypted-channel)
contracts/
  src/              Solidity contracts (AirnodeVerifier)
  test/             Foundry tests (unit, invariant, symbolic)
book/               Docusaurus documentation site
```

Key conventions:

- No catch-all folders like `utils/` or `helpers/`. Place files directly in `src/` with clear names. Group by domain
  only when there are multiple related files (e.g. `src/config/`, `src/api/`).
- Shared types inferred from Zod schemas live in `src/types.ts`.
- Example configs in `examples/configs/` must always pass schema validation (tested). Update them when the schema
  changes.
- Config format is YAML (parsed with `yaml` package). JSON also accepted.
- In config YAML, the `settings` section goes immediately after `version`, before `apis`.
- Runtime config is `config.yaml` + `.env` in the working directory (gitignored).
- **Explicit over implicit**: config fields should be required with no defaults, unless a default is genuinely universal
  (e.g. `method: GET`). Only truly optional behavior (like `rateLimit`, `cors`) uses optional fields. When adding new
  schema fields, default to required.

## Architecture

### HTTP-first signed API server

Airnode is an HTTP server (`Bun.serve`) that receives requests from clients, calls upstream APIs, signs the responses
with the airnode's private key (EIP-191), and returns the signed data. Clients can then submit the signed responses
on-chain themselves. There is no chain scanning, no coordinator cycle, no on-chain fulfillment — Airnode is a stateless
HTTP service.

Routes:

- `POST /endpoints/{endpointId}` — call an endpoint with parameters in the request body
- `GET /health` — health check with version and airnode address

### Request processing pipeline

The pipeline runs per-request in `src/pipeline.ts`:

1. **Resolve endpoint** → look up endpoint by ID in the endpoint map
2. **Plugin: onHttpRequest** → plugins can reject requests early
3. **Authenticate** → verify client credentials (free access or API key via `X-Api-Key` header)
4. **Validate parameters** → check that all required parameters are present
5. **Check cache** → return cached response if TTL has not expired
6. **Plugin: onBeforeApiCall** → plugins can modify parameters
7. **Call API** → make upstream HTTP request via `src/api/call.ts`
8. **Plugin: onAfterApiCall** → plugins can modify the response
9. **Encode** → if endpoint has `encoding`, ABI-encode using type/path/times via `src/api/process.ts`
10. **Plugin: onBeforeSign** → plugins can modify encoded data before signing
11. **Sign** → EIP-191 sign `keccak256(requestId || keccak256(data))` via `src/sign.ts`
12. **Cache** → store response if cache config is present
13. **Plugin: onResponseSent** → observation hook for logging/monitoring

### Config format

Version `'1.0'`. Top-level sections: `version`, `server`, `settings`, `apis`.

- `server` contains `port`, `host` (default `'0.0.0.0'`), `cors` (optional), `rateLimit` (optional).
- `settings` contains `timeout` (default 10s), `proof` (`'none'` for Phase 1), `plugins`.
- `apis[].url` is the upstream API base URL. Upstream credentials go in `apis[].headers`.
- `apis[].auth` is client-facing: `{ type: 'free' }` or `{ type: 'apiKey', keys: [...] }`.
- Endpoints use `encoding: { type, path, times? }` instead of `reservedParameters`. Encoding is optional — endpoints
  without it return raw JSON with a signature over the JSON hash.
- Auth and cache config inherit from API level; endpoint-level overrides take precedence.

### Plugin hooks

Plugins register hooks that fire during request processing. Budgets reset per request.

- `onHttpRequest` — can reject requests early (e.g. IP filtering, custom auth)
- `onBeforeApiCall` — can modify request parameters before the upstream API call
- `onAfterApiCall` — can modify the API response before encoding
- `onBeforeSign` — can modify encoded data before signing
- `onResponseSent` — observation only (logging, monitoring, heartbeats)
- `onError` — observation only (error alerting)

## Testing

- `bun test` / `bun run test:unit` — TypeScript unit tests rooted in `src/`. Coverage thresholds: 95% lines, functions,
  and statements (configured in `bunfig.toml`).
- `bun run test:contracts` — Foundry contract tests (`cd contracts && forge test`). Contracts are independent of the
  TypeScript node.

Test conventions:

- Each source file should have a co-located `.test.ts` file (e.g. `schema.ts` → `schema.test.ts`).
- Tests must assert exact values, not just shapes. For hex/encoded data, hardcode the expected output and compare with
  `toBe()`.

## Code style

- Always order `scripts` in `package.json` alphabetically.
- Functions must never exceed 3 levels of nesting, preferably 2 at most. Extract nested logic into named functions.
- Always use early returns. Never use `else` blocks — invert the condition and return early.
- Use single quotes. Backticks only when interpolating.
- Wrap numeric values in `String()` in template literals: `` `Chain ${String(chain.id)}` ``.
- All interface properties are `readonly`. Arrays use `readonly T[]` or `ReadonlyArray<T>`. Maps use `ReadonlyMap`.
- No mutations. Use `map`, `filter`, `reduce`, `Object.fromEntries`, spread. When a mutation is necessary (loops,
  `Map.set`), annotate with `// eslint-disable-line functional/immutable-data` or `functional/no-loop-statements`.
- No try/catch. Use `go()` from `@api3/promise-utils` for async, `goSync()` for sync. Always check `result.success`
  before accessing `result.data`. Early return on failure.
- Don't use non-null assertions (`!`). Use narrowing or optional chaining.
- Prefer readability over cleverness. Break complex expressions into named intermediate values.
- Named exports at the bottom of files with separate `export type { ... }` blocks.
- After finishing writing code, always run `bun run fmt` to format and fix lint issues.
- Lint commands: `bun lint` (all), `bun lint:prettier`, `bun lint:eslint`, `bun lint:slither`.
- ESLint uses `--cache` — don't use `bunx eslint .` directly.
- Use multilevel section comments to separate logical sections:
  ```ts
  // =============================================================================
  // Section name
  // =============================================================================
  const foo = ...
  ```
  77 `=` signs at top-level (80 chars total with `// `). 75 when indented.

## Contracts

Solidity contracts in `contracts/src/`, tested with Foundry. EVM target is `prague` (Pectra). See `contracts/README.md`
for full architecture docs.

- Tests deploy contracts directly with `new AirnodeVerifier()` in `setUp()`.
- Single blank lines between sections (no double blanks).

### Contract architecture

One contract:

| Contract              | Purpose                                               |
| --------------------- | ----------------------------------------------------- |
| `AirnodeVerifier.sol` | Verify signature, prevent replay, forward to callback |

Signature: `keccak256(encodePacked(endpointId, timestamp, data))` with EIP-191 personal sign. Permissionless — anyone
can submit. No admin, no registry, no roles.

### Signature format

```
hash = keccak256(encodePacked(endpointId, timestamp, data))
signature = EIP-191 personal sign over hash
```

The endpoint ID is a top-level field so future TLS proof verifiers can inspect it directly.

## Git

Do not add `Co-authored-by` trailers referencing Claude in commit messages.

## Design Context

### Users

API providers who want to serve data on-chain, smart contract developers integrating oracle feeds, and API3 DAO members
managing infrastructure. They are technical, time-constrained, and value clarity over decoration. The primary interface
is CLI + documentation — users arrive to get answers and leave.

### Brand Personality

Technical, Trustworthy, Minimal — confidence through precision and simplicity. Part of the API3 ecosystem (api3.org,
market.api3.org).

### Aesthetic Direction

- **Visual tone**: Minimal and clean. Generous whitespace, content-first, no visual clutter.
- **References**: api3.org and market.api3.org — the parent brand's visual language.
- **Theme**: Dark mode primary, light mode optional. Dark backgrounds with high-contrast text.
- **Colors**: Primary blue `#1843f5` (light) / `#7b9bff` (dark). Dark background `#0a0e2e` / surface `#111648`. CLI
  accent `#f3004b`. Accent yellow `#f3e37a` (from api3.org, available for highlights).
- **Typography**: System sans-serif stack via Docusaurus/Infima. Code blocks are the primary content type.

### Design Principles

1. **Content over chrome** — every visual element must serve comprehension. No decorative flourishes.
2. **Developer-native** — design for people who live in terminals and editors. Code examples > prose.
3. **Quiet confidence** — trustworthiness comes from clarity and consistency, not from bold visuals.
4. **Reduce to essentials** — if removing an element doesn't hurt understanding, remove it.
5. **Dark-first** — dark mode is the default experience; optimize contrast and readability there first.

## Documentation (book/)

Docusaurus site in `book/`. Run with `bun run --cwd book start`.
