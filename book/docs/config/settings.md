---
slug: /config/settings
sidebar_position: 3
---

# Settings

The `settings` section configures global behavior. It is placed immediately after `version` and `server`, before `apis`.

```yaml
settings:
  timeout: 10000 # default, ms
  proof: none # only option for now
  plugins:
    - source: ./plugins/heartbeat.ts
      timeout: 5000
```

## Fields

| Field     | Type     | Required | Default | Description                                            |
| --------- | -------- | -------- | ------- | ------------------------------------------------------ |
| `timeout` | `number` | No       | `10000` | Global upstream API request timeout in milliseconds.   |
| `proof`   | `string` | Yes      | --      | Proof mode. Currently only `'none'` is supported.      |
| `plugins` | `array`  | No       | `[]`    | Plugin entries. See [Plugin Configuration](./plugins). |

## `timeout`

Default timeout for upstream API requests in milliseconds. This applies to all APIs unless overridden at the API level
with `apis[].timeout`.

```yaml
settings:
  timeout: 15000 # 15 seconds for all APIs by default
```

## `proof`

Proof mode for response verification. Currently only `'none'` is supported. Future modes will include:

- `replay` -- deterministic replay proofs
- `tee` -- trusted execution environment attestation
- `tlsnotary` -- TLS session proofs via TLSNotary

```yaml
settings:
  proof: none
```

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
