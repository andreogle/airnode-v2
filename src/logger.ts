import { AsyncLocalStorage } from 'node:async_hooks';

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
type LogFormat = 'text' | 'json';

interface LogContext {
  readonly requestId: string;
}

const logStore = new AsyncLocalStorage<LogContext>();

// eslint-disable-next-line functional/no-let
let logFormat: LogFormat = 'text';

export function configureLogger(format: LogFormat): void {
  logFormat = format;
}

export function runWithContext<T>(context: LogContext, function_: () => T): T {
  return logStore.run(context, function_);
}

export function getContext(): LogContext | undefined {
  return logStore.getStore();
}

const MIN_MESSAGE_WIDTH = 80;

function formatText(level: LogLevel, message: string, context: LogContext | undefined): string {
  const timestamp = new Date().toISOString();
  const paddedMessage = message.padEnd(MIN_MESSAGE_WIDTH);
  const suffix = context ? `  requestId=${context.requestId}` : '';

  return `${timestamp} ${level} ${paddedMessage}${suffix}`;
}

function formatJson(level: LogLevel, message: string, context: LogContext | undefined, error?: Error): string {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(context ? { requestId: context.requestId } : {}),
    ...(error ? { error: { name: error.name, message: error.message, stack: error.stack } } : {}),
  };

  return JSON.stringify(entry);
}

function formatEntry(level: LogLevel, message: string, error?: Error): string {
  const context = logStore.getStore();

  if (logFormat === 'json') {
    return formatJson(level, message, context, error);
  }

  const base = formatText(level, message, context);
  if (!error?.stack) {
    return base;
  }

  return `${base}\n${error.stack}`;
}

export const logger = {
  info: (message: string): void => {
    console.info(formatEntry('INFO', message));
  },

  warn: (message: string): void => {
    console.warn(formatEntry('WARN', message));
  },

  error: (message: string, error?: Error): void => {
    console.error(formatEntry('ERROR', message, error));
  },

  debug: (message: string): void => {
    console.info(formatEntry('DEBUG', message));
  },
} as const;
