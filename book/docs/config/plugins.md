---
slug: /config/plugins
sidebar_position: 5
---

# Plugin Configuration

Plugins are declared in the `settings.plugins` array. Each entry specifies a source file and a timeout budget. When
omitted or empty, no plugins are loaded.

```yaml
settings:
  plugins:
    - source: ./plugins/heartbeat.ts
      timeout: 5000
    - source: ./plugins/slack-alerts.ts
      timeout: 3000
```

## Fields

| Field     | Type     | Required | Description                                                                                 |
| --------- | -------- | -------- | ------------------------------------------------------------------------------------------- |
| `source`  | `string` | Yes      | Path to the plugin file (`.ts` or `.js`). Resolved relative to the config file's directory. |
| `timeout` | `int`    | Yes      | Per-request time budget in milliseconds. Must be a positive integer.                        |

## Source resolution

The `source` path is resolved relative to the config file's directory, not the working directory. This means the same
config works regardless of where you run the start command from.

```yaml
# If config is at /home/airnode/config.yaml,
# this resolves to /home/airnode/plugins/heartbeat.ts
plugins:
  - source: ./plugins/heartbeat.ts
    timeout: 5000
```

Absolute paths are also accepted. Both `.ts` and `.js` files work -- use `.ts` during development (Bun transpiles on the
fly) and `.js` for pre-built bundles.

## Timeout budget

The `timeout` value is the total time the plugin can spend across all hook invocations in a single request. When a
plugin exceeds its budget, subsequent hooks for that plugin are skipped for the remainder of the request. Budgets reset
between requests.

Guidelines:

- **Logging/metrics plugins** that write to local systems: 1000ms
- **Webhook plugins** that make HTTP calls: 3000--5000ms
- **Security plugins** that call external services: 5000--10000ms

## Ordering

Plugins run in the order they are declared. For mutation hooks (`onBeforeApiCall`, `onAfterApiCall`, `onBeforeSign`),
each plugin receives the output of the previous one.

## Plugin name

There is no `name` field in the config. The plugin's exported `name` (from its default export) is used for logging and
budget tracking.

## Further reading

For details on writing plugins, lifecycle hooks, and examples, see the [Plugins](/docs/plugins) page.
