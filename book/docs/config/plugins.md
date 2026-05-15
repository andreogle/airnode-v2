---
slug: /config/plugins
sidebar_position: 5
---

# Plugin Configuration

Plugins are declared in the `settings.plugins` array. Each entry specifies a source file, a timeout budget, and an
optional `config` block handed to the plugin. When omitted or empty, no plugins are loaded.

```yaml
settings:
  plugins:
    - source: ./plugins/heartbeat.ts
      timeout: 5000
      config:
        url: ${HEARTBEAT_URL}
    - source: ./plugins/slack-alerts.ts
      timeout: 3000
      config:
        webhookUrl: ${SLACK_WEBHOOK_URL}
```

## Fields

| Field     | Type     | Required | Description                                                                                  |
| --------- | -------- | -------- | -------------------------------------------------------------------------------------------- |
| `source`  | `string` | Yes      | Path to the plugin file (`.ts` or `.js`). Resolved relative to the config file's directory.  |
| `timeout` | `number` | Yes      | Per-request time budget in milliseconds. Must be a positive integer.                         |
| `config`  | `object` | No       | Key/value config handed to the plugin. Values support `${ENV}` interpolation. Defaults `{}`. |

## Plugin config

Anything a plugin needs — webhook URLs, API tokens, even the airnode's private key for a plugin that genuinely requires
it — is passed explicitly through `config`, not read from `process.env` by the plugin. The values support `${ENV}`
interpolation like the rest of the config, so secrets stay in your `.env`:

```yaml
plugins:
  - source: ./plugins/slack-alerts.ts
    timeout: 3000
    config:
      webhookUrl: ${SLACK_WEBHOOK_URL}
```

A plugin may export a `configSchema` describing the shape it expects. **The airnode validates `config` against it on
startup** — a missing or malformed value (a typo'd URL, an absent required key) fails the boot with a clear error rather
than surfacing at first-request time. If a plugin exports no schema, the shape is the plugin's own responsibility; if a
plugin doesn't accept config at all and you give it some, it's ignored with a warning.

`config` is a configuration mechanism, not a sandbox: plugins still run as trusted code inside the airnode process. See
[Plugins → trust](/docs/plugins) before adding one.

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

## Caching interaction

The HTTP response cache (`apis[].cache.maxAge` or `endpoints[].cache.maxAge`) stores the entire signed response — data,
signature, and timestamp — for the TTL window. Cached responses bypass the upstream API call, which also bypasses every
hook from `onBeforeApiCall` onward:

- `onBeforeApiCall`, `onAfterApiCall`, `onBeforeSign` — **only fire on the first request in each cache window**. Cached
  hits within the TTL never invoke them.
- `onHttpRequest`, `onResponseSent`, `onError` — fire on every request, cached or not.

If your plugin tracks per-request signal (heartbeats, counters, alerting), put that work in `onResponseSent` or
`onHttpRequest`. Don't rely on the mutation hooks to run once per HTTP request — they run once per upstream API call,
which can be much rarer.

## Plugin name

There is no `name` field in the config. The plugin's exported `name` (from its default export, or from the object its
factory returns) is used for logging and budget tracking.

## Further reading

For details on writing plugins, lifecycle hooks, and examples, see the [Plugins](/docs/plugins) page.
