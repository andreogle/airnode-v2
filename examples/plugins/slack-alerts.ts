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
//         config:
//           webhookUrl: ${SLACK_WEBHOOK_URL}   # required — create one at
//                                               # https://api.slack.com/messaging/webhooks
//
// `webhookUrl` is required: the airnode validates `config` against `configSchema`
// (below) on startup, so a missing/malformed webhook fails the boot.
// =============================================================================

import { z } from 'zod/v4';

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
// Config — validated by the airnode at startup
// =============================================================================
export const configSchema = z.object({
  webhookUrl: z.url(),
});

type Config = z.infer<typeof configSchema>;

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
// Plugin factory — receives the validated config and returns the plugin
// =============================================================================
export default function slackAlerts(config: Config): AirnodePlugin {
  return {
    name: 'slack-alerts',
    hooks: {
      onError: async (ctx: ErrorContext) => {
        await fetch(config.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: formatSlackMessage(ctx) }),
          signal: ctx.signal,
        });
      },
    },
  };
}
