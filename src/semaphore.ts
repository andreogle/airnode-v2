// =============================================================================
// Bounded-concurrency semaphore
//
// Caps how many things can run at once. `acquire(timeoutMs)` resolves with a
// release function once a slot is free, or `undefined` if no slot opened up
// within `timeoutMs` (the caller should then fail fast rather than queue
// forever). Waiters are served FIFO. Releasing is idempotent.
//
// Used to bound concurrent upstream API calls so a burst of requests can't fan
// out an unbounded number of `fetch`es to the operator's (metered) APIs.
// =============================================================================

type Release = () => void;
type Waiter = (release: Release) => void;

interface Semaphore {
  readonly acquire: (timeoutMs: number) => Promise<Release | undefined>;
}

function createSemaphore(maxConcurrent: number): Semaphore {
  // eslint-disable-next-line functional/no-let
  let available = maxConcurrent;
  const waiters: Waiter[] = [];

  function makeRelease(): Release {
    // eslint-disable-next-line functional/no-let
    let released = false;
    return () => {
      if (released) return; // idempotent — safe to call more than once
      released = true;
      const next = waiters.shift(); // eslint-disable-line functional/immutable-data
      if (next) {
        next(makeRelease()); // hand the freed slot straight to the next waiter
        return;
      }
      available++;
    };
  }

  return {
    acquire: (timeoutMs: number): Promise<Release | undefined> => {
      if (available > 0) {
        available--;
        return Promise.resolve(makeRelease());
      }

      return new Promise<Release | undefined>((resolve) => {
        // eslint-disable-next-line functional/no-let
        let settled = false;

        const onSlot: Waiter = (release) => {
          if (settled) {
            // Timed out already but still got handed a slot — give it back.
            release();
            return;
          }
          settled = true;
          resolve(release);
        };

        waiters.push(onSlot); // eslint-disable-line functional/immutable-data

        // The timer is left to fire even after a successful acquire — it's a
        // no-op once `settled`, and avoiding a mutual `clearTimeout` reference
        // keeps this readable. A timer is only created on the contended path.
        setTimeout(() => {
          if (settled) return;
          settled = true;
          const index = waiters.indexOf(onSlot);
          if (index !== -1) waiters.splice(index, 1); // eslint-disable-line functional/immutable-data
          // eslint-disable-next-line unicorn/no-useless-undefined
          resolve(undefined);
        }, timeoutMs);
      });
    },
  };
}

export { createSemaphore };
export type { Release, Semaphore };
