---
slug: /plugins
sidebar_position: 9
---

# Plugins

Plugins extend Airnode's request processing pipeline. They can reject requests, modify parameters, transform responses,
alter encoded data, and observe events -- all without modifying the core node.

:::danger Plugins run as trusted code

A plugin runs **inside the airnode process** with the airnode's full privileges -- its environment variables, its
filesystem, and its signing key. There is no sandbox. An `onBeforeSign` plugin can substitute the exact bytes the
airnode signs, so it effectively shares signing-key authority (the airnode logs a `SECURITY:` warning at startup listing
any such plugins). The `config:` block (below) is for clean configuration -- explicit, validated, no implicit
`process.env` grubbing -- **not** a security boundary.

**Only run plugins you would trust with your private key.** Pin and review plugin sources the same way you protect the
key itself; when running third-party plugins, prefer real environment variables or a secret manager over an on-disk
`.env` (a plugin can read files the airnode can reach).

:::

## Hook overview

Six hooks fire at specific points in the pipeline:

| Hook              | Type        | Can modify                  | When it fires                                               |
| ----------------- | ----------- | --------------------------- | ----------------------------------------------------------- |
| `onHttpRequest`   | Mutation    | Reject the request          | After endpoint resolution, before auth                      |
| `onBeforeApiCall` | Mutation    | Request parameters          | Before the upstream API call                                |
| `onAfterApiCall`  | Mutation    | Response data and status    | After the upstream API responds                             |
| `onBeforeSign`    | Mutation    | The data about to be signed | After encoding (and FHE encryption, if any), before signing |
| `onResponseSent`  | Observation | Nothing (read-only)         | After the signed response is sent                           |
| `onError`         | Observation | Nothing (read-only)         | When an error occurs at any stage                           |

For an `encrypt`-configured endpoint, `onBeforeSign` sees the FHE ciphertext
(`abi.encode(bytes32 handle, bytes proof)`), not the plaintext-encoded value. Every hook context also includes a
`requestId` (a per-request hex id), in addition to the fields shown below.

**Mutation hooks** can change the pipeline. If a mutation hook fails or times out, the request is **dropped** rather
than processed without the plugin's intervention. This prevents data leaks if the plugin exists for security purposes.

**Observation hooks** are fire-and-forget. If they fail or time out, processing continues normally.

## Plugin interface

```typescript
interface AirnodePlugin {
  readonly name: string;
  readonly hooks: PluginHooks;
}

interface PluginHooks {
  readonly onHttpRequest?: (ctx: HttpRequestContext) => HttpRequestResult | Promise<HttpRequestResult>;
  readonly onBeforeApiCall?: (ctx: BeforeApiCallContext) => BeforeApiCallResult | Promise<BeforeApiCallResult>;
  readonly onAfterApiCall?: (ctx: AfterApiCallContext) => AfterApiCallResult | Promise<AfterApiCallResult>;
  readonly onBeforeSign?: (ctx: BeforeSignContext) => BeforeSignResult | Promise<BeforeSignResult>;
  readonly onResponseSent?: (ctx: ResponseSentContext) => void | Promise<void>;
  readonly onError?: (ctx: ErrorContext) => void | Promise<void>;
}
```

A plugin module's **default export** is either a ready `AirnodePlugin` (no config) or a **factory** that receives the
validated `config` and returns one. It may also export a `configSchema` that the airnode validates `config` against on
startup. Plugins should **not** read `process.env` directly — everything they need (including the airnode's private key,
if they genuinely require it) is granted explicitly through
[`settings.plugins[].config`](/docs/config/plugins#plugin-config).

```typescript
// no config — a plain object:
export default { name: 'request-logger', hooks: { ... } } satisfies AirnodePlugin;

// with config — a factory plus a schema validated at startup:
import { z } from 'zod/v4';
export const configSchema = z.object({ webhookUrl: z.url() });
export default (config: z.infer<typeof configSchema>): AirnodePlugin => ({
  name: 'slack-alerts',
  hooks: { onError: (ctx) => fetch(config.webhookUrl, /* ... */) },
});
```

## Example plugin

A simple request logger (no config — a plain default export):

```typescript
const plugin: AirnodePlugin = {
  name: 'request-logger',
  hooks: {
    onHttpRequest: (ctx) => {
      console.log(`Request: ${ctx.endpoint} [${ctx.endpointId}]`);
      return undefined; // pass through
    },
    onResponseSent: (ctx) => {
      console.log(`Response: ${ctx.endpoint} in ${String(ctx.duration)}ms`);
    },
    onError: (ctx) => {
      console.error(`Error in ${ctx.stage}: ${ctx.error.message}`);
    },
  },
};

export default plugin;
```

## Hook details

### onHttpRequest

Fires after endpoint resolution, before authentication. Return `{ reject: true, status, message }` to reject the
request. Return `undefined` to pass through.

```typescript
onHttpRequest: (ctx) => {
  if (ctx.parameters['blocked'] === 'true') {
    return { reject: true, status: 403, message: 'Blocked' };
  }
  return undefined;
};
```

### onBeforeApiCall

Fires before the upstream API call. Return `{ parameters }` to override request parameters. Return `undefined` to pass
through.

```typescript
onBeforeApiCall: (ctx) => {
  return { parameters: { ...ctx.parameters, source: 'airnode' } };
};
```

### onAfterApiCall

Fires after the upstream API responds. Return `{ data, status }` to override the response. Return `undefined` to pass
through.

```typescript
onAfterApiCall: (ctx) => {
  const { ssn, ...safe } = ctx.response.data as Record<string, unknown>;
  return { data: safe, status: ctx.response.status };
};
```

### onBeforeSign

Fires after encoding, before the airnode signs the data. Return `{ data }` (hex) to override the encoded data. Return
`undefined` to pass through.

### onResponseSent

Fires after the signed response is sent to the client. Observation only -- the return value is ignored.

### onError

Fires when an error occurs at any pipeline stage. Observation only. The context includes `error`, `stage`, and
optionally `endpointId`.

## Time budgets

Each plugin has a per-request time budget (the `timeout` value from config). The budget is the total time the plugin can
spend across all hook calls in a single request. The budget resets per request.

When the budget runs out:

- **Mutation hooks** cause the request to be **dropped**. The client receives an error response.
- **Observation hooks** are **skipped** with a warning. Processing continues normally.

Every hook receives an `AbortSignal` in its context. Pass it to `fetch()` or any async operation so your plugin
cooperates with cancellation:

```typescript
onResponseSent: async (ctx) => {
  await fetch('https://heartbeat.example.com', {
    method: 'POST',
    body: JSON.stringify({ endpoint: ctx.endpoint }),
    signal: ctx.signal,
  });
};
```

## Plugin pipeline

When multiple plugins define the same hook, they run in config-declared order:

- **Observation hooks**: Each plugin sees the same context. One plugin crashing does not prevent the next from running.
- **Mutation hooks**: Each plugin sees the output of the previous. If plugin A modifies parameters in `onBeforeApiCall`,
  plugin B sees the modified values.

## Configuration

Operators wire plugins into the YAML config under `settings.plugins`. See
[Plugin Configuration](/docs/config/plugins) for the field reference, source-path resolution, `config:` block, startup
validation, and timeout-budget guidelines.

## Distribution

During development, point `source` at a TypeScript file — Bun runs it directly. For production, compile to a single JS
bundle:

```bash
bun build src/index.ts --outfile dist/plugin.js --target bun
```

The output must be an ES module whose default export is an `AirnodePlugin` (or a factory returning one).

## Example plugins

The repository includes example plugins in
[`examples/plugins/`](https://github.com/api3dao/airnode-v2/tree/main/examples/plugins):

| Plugin                 | Description                                                                   |
| ---------------------- | ----------------------------------------------------------------------------- |
| `heartbeat.ts`         | POST to a monitoring URL after each response                                  |
| `logger.ts`            | Log at every hook -- useful for debugging and as a plugin authoring reference |
| `slack-alerts.ts`      | Post to Slack on errors                                                       |
| `encrypted-channel.ts` | Encrypt request parameters and response data using ECIES                      |
