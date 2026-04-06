---
slug: /config/settings
sidebar_position: 3
---

# Settings

The `settings` section configures global behavior. It is placed immediately after `version` and `server`, before `apis`.

```yaml
settings:
  timeout: 10000 # default, ms
  proof: none
  plugins:
    - source: ./plugins/heartbeat.ts
      timeout: 5000
```

## Fields

| Field     | Type               | Required | Default  | Description                                            |
| --------- | ------------------ | -------- | -------- | ------------------------------------------------------ |
| `timeout` | `number`           | No       | `10000`  | Global upstream API request timeout in milliseconds.   |
| `proof`   | `string \| object` | No       | `'none'` | Proof mode. See [Proof](#proof).                       |
| `plugins` | `array`            | No       | `[]`     | Plugin entries. See [Plugin Configuration](./plugins). |

## `timeout`

Default timeout for upstream API requests in milliseconds. This applies to all APIs unless overridden at the API level
with `apis[].timeout`.

```yaml
settings:
  timeout: 15000 # 15 seconds for all APIs by default
```

## `proof`

Controls whether TLS proofs are attached to responses. Two modes are supported:

### No proof (default)

```yaml
settings:
  proof: none
```

Responses contain only the EIP-191 signature. No proof is generated.

### Reclaim TLS proof

```yaml
settings:
  proof:
    type: reclaim
    gatewayUrl: http://localhost:5177/v1/prove
```

| Field        | Type     | Required | Description                                                  |
| ------------ | -------- | -------- | ------------------------------------------------------------ |
| `type`       | `string` | Yes      | Must be `'reclaim'`.                                         |
| `gatewayUrl` | `string` | Yes      | Full URL of the proof gateway endpoint. Must be a valid URL. |

When enabled, Airnode requests a TLS proof from the gateway after each API call. The proof is attached to the response
in a `proof` field alongside the signature. See [TLS Proofs](/docs/concepts/proofs) for details on how proofs work.

**Important:** `gatewayUrl` must be the **full URL** to the proof endpoint (e.g., `http://localhost:5177/v1/prove`), not
just a base URL. Airnode sends the request directly to this URL.

Proof generation is **non-fatal**. If the proof gateway is unavailable or returns an error, the response is still
returned without the `proof` field and a warning is logged. This ensures proof failures do not block data delivery.

Endpoints must have [`responseMatches`](/docs/config/apis#responsematches) configured for proof generation to be
requested. Endpoints without `responseMatches` skip proof generation even when proof is enabled globally.

## `plugins`

An array of plugin entries. Each entry specifies a source file and a timeout budget. When omitted or empty, no plugins
are loaded.

```yaml
settings:
  plugins:
    - source: ./plugins/heartbeat.ts
      timeout: 5000
    - source: ./plugins/slack-alerts.ts
      timeout: 3000
```

See [Plugin Configuration](./plugins) for details on source resolution, timeout budgets, and ordering.
