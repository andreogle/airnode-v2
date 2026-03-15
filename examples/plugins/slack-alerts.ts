// =============================================================================
// Slack alerts plugin
//
// Posts a message to a Slack channel via incoming webhook whenever an error
// occurs during request processing. Useful for getting immediate notifications
// when API calls fail, signing errors occur, or other issues arise.
//
// Usage (in config.yaml):
//   settings:
//     plugins:
//       - source: ./examples/plugins/slack-alerts.ts
//         timeout: 5000
//
// Environment variables:
//   SLACK_WEBHOOK_URL - Slack incoming webhook URL (required)
//     Create one at: https://api.slack.com/messaging/webhooks
// =============================================================================

// =============================================================================
// Plugin types (inlined — the package does not export them yet)
// =============================================================================
type Hex = `0x${string}`;

interface ErrorContext {
  readonly error: Error;
  readonly stage: string;
  readonly endpointId?: Hex;
  readonly signal: AbortSignal;
}

interface AirnodePlugin {
  readonly name: string;
  readonly hooks: {
    readonly onError?: (context: ErrorContext) => void | Promise<void>;
  };
}

// =============================================================================
// Slack message formatting
// =============================================================================
function formatSlackMessage(ctx: ErrorContext): string {
  const parts = [`*Airnode error in \`${ctx.stage}\`*`, `> ${ctx.error.message}`];

  if (ctx.endpointId) {
    parts.push(`Endpoint: \`${ctx.endpointId}\``); // eslint-disable-line functional/immutable-data
  }

  return parts.join('\n');
}

// =============================================================================
// Plugin implementation
// =============================================================================
const SLACK_WEBHOOK_URL = process.env['SLACK_WEBHOOK_URL'];

const plugin: AirnodePlugin = {
  name: 'slack-alerts',
  hooks: {
    onError: async (ctx: ErrorContext) => {
      if (!SLACK_WEBHOOK_URL) return;

      await fetch(SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: formatSlackMessage(ctx) }),
        signal: ctx.signal,
      });
    },
  },
};

export default plugin;
