import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { configureLogger, getContext, logger, runWithContext } from './logger';

const infoMock = mock();
const warnMock = mock();
const errorMock = mock();

console.info = infoMock;
console.warn = warnMock;
console.error = errorMock;

beforeEach(() => {
  configureLogger('text');
});

afterEach(() => {
  infoMock.mockClear();
  warnMock.mockClear();
  errorMock.mockClear();
});

const TEST_CONTEXT = { requestId: 'req-abc123' } as const;

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z/;

function lastCall(mockFunction: ReturnType<typeof mock>): string {
  return String(mockFunction.mock.calls.at(-1)?.[0]);
}

describe('text format', () => {
  test('includes timestamp and level', () => {
    logger.info('hello');
    const output = lastCall(infoMock);
    expect(output).toMatch(ISO_TIMESTAMP);
    expect(output).toContain(' INFO ');
    expect(output).toContain('hello');
  });

  test('metadata appears at the end without brackets', () => {
    runWithContext(TEST_CONTEXT, () => {
      logger.info('hello');
    });
    const output = lastCall(infoMock);
    expect(output).toMatch(/hello\s+requestId=req-abc123$/);
  });

  test('no metadata suffix when no context is set', () => {
    logger.info('no context');
    const output = lastCall(infoMock);
    expect(output).toMatch(/INFO no context\s*$/);
  });

  test('info uses INFO level and console.info', () => {
    logger.info('msg');
    expect(lastCall(infoMock)).toContain(' INFO ');
  });

  test('warn uses WARN level and console.warn', () => {
    logger.warn('msg');
    expect(lastCall(warnMock)).toContain(' WARN ');
  });

  test('error uses ERROR level and console.error', () => {
    logger.error('msg');
    expect(lastCall(errorMock)).toContain(' ERROR ');
  });

  test('debug uses DEBUG level and console.info', () => {
    logger.debug('msg');
    expect(lastCall(infoMock)).toContain(' DEBUG ');
  });

  test('error includes stack trace when given an Error', () => {
    const error = new Error('boom');
    logger.error('something failed', error);
    const output = lastCall(errorMock);
    expect(output).toContain(' ERROR something failed');
    expect(output).toContain('\n');
    expect(output).toContain('Error: boom');
    expect(output).toContain('logger.test.ts');
  });

  test('error without Error object has no stack trace', () => {
    logger.error('simple error');
    const output = lastCall(errorMock);
    expect(output).not.toContain('\n');
  });

  test('pads short messages to minimum width so metadata aligns', () => {
    runWithContext(TEST_CONTEXT, () => {
      logger.info('short');
    });
    const output = lastCall(infoMock);
    const afterLevel = output.split(' INFO ')[1] ?? '';
    const beforeMeta = afterLevel.split('requestId=')[0] ?? '';
    expect(beforeMeta.length).toBeGreaterThanOrEqual(80);
  });

  test('does not truncate messages longer than minimum width', () => {
    const longMessage = 'x'.repeat(120);
    logger.info(longMessage);
    const output = lastCall(infoMock);
    expect(output).toContain(longMessage);
  });

  test('context propagates through nested function calls', () => {
    runWithContext(TEST_CONTEXT, () => {
      logger.info('deep');
    });
    expect(lastCall(infoMock)).toContain('requestId=req-abc123');
  });

  test('context is available in async functions', async () => {
    await runWithContext(TEST_CONTEXT, async () => {
      await Promise.resolve();
      logger.info('async');
    });
    expect(lastCall(infoMock)).toContain('requestId=req-abc123');
  });

  test('context is isolated between concurrent runs', async () => {
    const messages: string[] = [];
    console.info = (...arguments_: unknown[]) => {
      messages.push(String(arguments_[0]));
    };

    const run1 = new Promise<void>((resolve) => {
      runWithContext({ requestId: 'req-1' }, () => {
        setTimeout(() => {
          logger.info('from run 1');
          resolve();
        }, 10);
      });
    });

    const run2 = new Promise<void>((resolve) => {
      runWithContext({ requestId: 'req-2' }, () => {
        setTimeout(() => {
          logger.info('from run 2');
          resolve();
        }, 5);
      });
    });

    await Promise.all([run1, run2]);

    const run1Message = messages.find((m) => m.includes('from run 1'));
    const run2Message = messages.find((m) => m.includes('from run 2'));
    expect(run1Message).toContain('requestId=req-1');
    expect(run2Message).toContain('requestId=req-2');

    console.info = infoMock;
  });
});

describe('json format', () => {
  beforeEach(() => {
    configureLogger('json');
  });

  test('outputs valid JSON with required fields', () => {
    logger.info('hello');
    const parsed = JSON.parse(lastCall(infoMock)) as Record<string, unknown>;
    expect(parsed.level).toBe('INFO');
    expect(parsed.message).toBe('hello');
    expect(parsed.timestamp).toMatch(ISO_TIMESTAMP);
  });

  test('includes context fields', () => {
    runWithContext(TEST_CONTEXT, () => {
      logger.info('hello');
    });
    const parsed = JSON.parse(lastCall(infoMock)) as Record<string, unknown>;
    expect(parsed.requestId).toBe('req-abc123');
  });

  test('omits context fields when no context is set', () => {
    logger.info('no context');
    const parsed = JSON.parse(lastCall(infoMock)) as Record<string, unknown>;
    expect(parsed.requestId).toBeUndefined();
  });

  test('error includes error object with stack', () => {
    const error = new Error('boom');
    logger.error('failed', error);
    const parsed = JSON.parse(lastCall(errorMock)) as Record<string, unknown>;
    expect(parsed.level).toBe('ERROR');
    expect(parsed.message).toBe('failed');
    const errorField = parsed.error as Record<string, unknown>;
    expect(errorField.name).toBe('Error');
    expect(errorField.message).toBe('boom');
    expect(typeof errorField.stack).toBe('string');
  });

  test('error without Error object has no error field', () => {
    logger.error('simple');
    const parsed = JSON.parse(lastCall(errorMock)) as Record<string, unknown>;
    expect(parsed.error).toBeUndefined();
  });

  test('warn outputs correct level', () => {
    logger.warn('warning');
    const parsed = JSON.parse(lastCall(warnMock)) as Record<string, unknown>;
    expect(parsed.level).toBe('WARN');
  });

  test('debug outputs correct level', () => {
    logger.debug('debugging');
    const parsed = JSON.parse(lastCall(infoMock)) as Record<string, unknown>;
    expect(parsed.level).toBe('DEBUG');
  });
});

describe('getContext', () => {
  test('returns undefined outside of run', () => {
    expect(getContext()).toBeUndefined();
  });

  test('returns context inside run', () => {
    runWithContext(TEST_CONTEXT, () => {
      expect(getContext()).toEqual(TEST_CONTEXT);
    });
  });
});

describe('runWithContext', () => {
  test('returns the value from the callback', () => {
    const result = runWithContext(TEST_CONTEXT, () => 42);
    expect(result).toBe(42);
  });

  test('returns async value from callback', async () => {
    const result = await runWithContext(TEST_CONTEXT, async () => {
      await Promise.resolve();
      return 'async result';
    });
    expect(result).toBe('async result');
  });
});
