import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createTestServer, findEndpointId, post } from '../helpers';
import type { TestContext } from '../helpers';

let ctx: TestContext;

const infoMock = mock();
const originalInfo = console.info;

beforeAll(async () => {
  ctx = await createTestServer();
});

afterAll(() => {
  ctx.stop();
  console.info = originalInfo;
});

beforeEach(() => {
  console.info = infoMock;
});

afterEach(() => {
  console.info = originalInfo;
  infoMock.mockClear();
});

describe('S21 — Request logging context', () => {
  test('log messages include requestId', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');
    await post(ctx.baseUrl, endpointId, { q: 'London' });

    const logMessages = infoMock.mock.calls.map((call) => String(call[0]));
    const processingLog = logMessages.find((m) => m.includes('Processing'));

    expect(processingLog).toBeDefined();
    expect(processingLog).toMatch(/requestId=0x[\da-f]{64}/);
  });

  test('different requests get different requestIds', async () => {
    const endpointId = findEndpointId(ctx.endpointMap, 'WeatherAPI', 'currentTemp');

    await post(ctx.baseUrl, endpointId, { q: 'London' });
    const firstLogs = infoMock.mock.calls.map((call) => String(call[0]));
    infoMock.mockClear();

    await post(ctx.baseUrl, endpointId, { q: 'Tokyo' });
    const secondLogs = infoMock.mock.calls.map((call) => String(call[0]));

    const firstId = firstLogs.find((m) => m.includes('requestId='))?.match(/requestId=(0x[\da-f]{64})/)?.[1];
    const secondId = secondLogs.find((m) => m.includes('requestId='))?.match(/requestId=(0x[\da-f]{64})/)?.[1];

    expect(firstId).toBeDefined();
    expect(secondId).toBeDefined();
    expect(firstId).not.toBe(secondId);
  });
});
