import { describe, expect, test } from 'bun:test';
import { createAsyncRequestStore } from './async';
import type { AsyncRequestStore, PendingRequest } from './async';

function mustCreate(store: AsyncRequestStore): PendingRequest {
  const req = store.create();
  if (!req) throw new Error('async store unexpectedly full');
  return req;
}

describe('createAsyncRequestStore', () => {
  test('creates a pending request', () => {
    const store = createAsyncRequestStore();
    const req = mustCreate(store);

    expect(req.requestId).toMatch(/^0x/);
    expect(req.status).toBe('pending');
    expect(req.createdAt).toBeGreaterThan(0);

    store.stop();
  });

  test('retrieves a created request', () => {
    const store = createAsyncRequestStore();
    const req = mustCreate(store);

    const retrieved = store.get(req.requestId);
    expect(retrieved).toBeDefined();
    expect(retrieved?.requestId).toBe(req.requestId);

    store.stop();
  });

  test('transitions through statuses', () => {
    const store = createAsyncRequestStore();
    const req = mustCreate(store);

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
    const req = mustCreate(store);

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
    const r1 = mustCreate(store);
    const r2 = mustCreate(store);

    expect(r1.requestId).not.toBe(r2.requestId);

    store.stop();
  });

  test('refuses new requests when full of in-flight requests', () => {
    const store = createAsyncRequestStore();
    Array.from({ length: 100 }, () => store.create());
    expect(store.create()).toBeUndefined();
    store.stop();
  });

  test('a freshly finished request is retained for polling but still holds its slot', () => {
    const store = createAsyncRequestStore();
    const created = Array.from({ length: 100 }, () => {
      const req = store.create();
      if (req) store.setComplete(req.requestId, { ok: true });
      return req;
    });
    // The slots are still occupied (results retained), so a new request is refused...
    expect(store.create()).toBeUndefined();
    // ...and the finished results remain retrievable in the meantime.
    const first = created[0];
    expect(first && store.get(first.requestId)?.result).toEqual({ ok: true });
    expect(first && store.get(first.requestId)?.finishedAt).toBeGreaterThan(0);
    store.stop();
  });
});
