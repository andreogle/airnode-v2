import { describe, expect, test } from 'bun:test';
import { createSemaphore } from './semaphore';

describe('createSemaphore', () => {
  test('hands out up to maxConcurrent slots immediately', async () => {
    const sem = createSemaphore(2);
    const a = await sem.acquire(1000);
    const b = await sem.acquire(1000);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
  });

  test('a request over the limit waits until a slot is released', async () => {
    const sem = createSemaphore(1);
    const first = await sem.acquire(1000);
    if (!first) throw new Error('expected a slot');

    let secondGotSlot = false;
    const secondPromise = sem.acquire(1000).then((r) => {
      secondGotSlot = r !== undefined;
      return r;
    });

    await Bun.sleep(20);
    expect(secondGotSlot).toBe(false); // still waiting

    first(); // release the only slot
    const second = await secondPromise;
    expect(second).toBeDefined();
  });

  test('returns undefined when no slot opens up within the timeout', async () => {
    const sem = createSemaphore(1);
    const held = await sem.acquire(1000);
    expect(held).toBeDefined();

    const start = Date.now();
    const result = await sem.acquire(40);
    expect(result).toBeUndefined();
    expect(Date.now() - start).toBeGreaterThanOrEqual(35);
  });

  test('serves waiters FIFO', async () => {
    const sem = createSemaphore(1);
    const slot = await sem.acquire(1000);
    if (!slot) throw new Error('expected a slot');

    const order: number[] = [];
    const p1 = sem.acquire(1000).then((r) => {
      order.push(1);
      return r;
    });
    const p2 = sem.acquire(1000).then((r) => {
      order.push(2);
      return r;
    });

    slot(); // wakes p1, which gets the slot
    const r1 = await p1;
    r1?.(); // p1 releases → wakes p2
    await p2;

    expect(order).toEqual([1, 2]);
  });

  test('release is idempotent', async () => {
    const sem = createSemaphore(1);
    const slot = await sem.acquire(1000);
    if (!slot) throw new Error('expected a slot');
    slot();
    slot(); // second release must not free an extra slot

    // Only one slot total, so two concurrent acquires: one immediate, one waits.
    const a = await sem.acquire(1000);
    expect(a).toBeDefined();
    const b = await sem.acquire(30);
    expect(b).toBeUndefined();
  });
});
