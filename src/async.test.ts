import { describe, expect, test } from 'bun:test';
import type { Hex } from 'viem';
import { createAsyncRequestStore } from './async';

describe('createAsyncRequestStore', () => {
  const ENDPOINT_ID: Hex = '0x04e77a11d6561a70385e2e8e315989cb24bb35128cb4d5a8b3ece93a3c72295b';

  test('creates a pending request', () => {
    const store = createAsyncRequestStore();
    const req = store.create(ENDPOINT_ID);

    expect(req.requestId).toMatch(/^0x/);
    expect(req.status).toBe('pending');
    expect(req.createdAt).toBeGreaterThan(0);

    store.stop();
  });

  test('retrieves a created request', () => {
    const store = createAsyncRequestStore();
    const req = store.create(ENDPOINT_ID);

    const retrieved = store.get(req.requestId);
    expect(retrieved).toBeDefined();
    expect(retrieved?.requestId).toBe(req.requestId);

    store.stop();
  });

  test('transitions through statuses', () => {
    const store = createAsyncRequestStore();
    const req = store.create(ENDPOINT_ID);

    expect(store.get(req.requestId)?.status).toBe('pending');

    store.setProcessing(req.requestId);
    expect(store.get(req.requestId)?.status).toBe('processing');

    store.setComplete(req.requestId, { data: '0x123' });
    expect(store.get(req.requestId)?.status).toBe('complete');
    expect(store.get(req.requestId)?.result).toEqual({ data: '0x123' });

    store.stop();
  });

  test('handles failure status', () => {
    const store = createAsyncRequestStore();
    const req = store.create(ENDPOINT_ID);

    store.setProcessing(req.requestId);
    store.setFailed(req.requestId, 'API timeout');

    expect(store.get(req.requestId)?.status).toBe('failed');
    expect(store.get(req.requestId)?.error).toBe('API timeout');

    store.stop();
  });

  test('returns undefined for unknown request', () => {
    const store = createAsyncRequestStore();
    expect(store.get('0xnonexistent')).toBeUndefined();
    store.stop();
  });

  test('generates unique request IDs', () => {
    const store = createAsyncRequestStore();
    const r1 = store.create(ENDPOINT_ID);
    const r2 = store.create(ENDPOINT_ID);

    expect(r1.requestId).not.toBe(r2.requestId);

    store.stop();
  });
});
