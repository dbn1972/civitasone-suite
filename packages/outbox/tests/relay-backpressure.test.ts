/**
 * Relay backpressure.
 *
 * `startRelay` fires on a fixed 500ms interval. Without an in-flight guard, a
 * slow or stuck cycle (publishes waiting on a saturated socket pool) does not
 * stop the next tick from starting another relayOnce, stacking concurrent
 * batches that each grab 100 rows and pile more in-flight SendMessage calls on
 * — the runaway that exhausted the pool. These tests prove only one cycle runs
 * at a time, and that a fast cycle still runs every tick.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { startRelay, type DrizzleTx } from "../src/index.js";

type Queue = Parameters<typeof startRelay>[1];

/**
 * Fake Drizzle handle whose `select().from().where().limit()` chain resolves
 * with `rowFactory()`. When it returns a never-resolving promise the relay
 * cycle hangs, letting us assert the guard blocks overlapping ticks.
 */
function fakeDb(rowFactory: () => Promise<unknown[]>): { db: DrizzleTx; selectCalls: () => number } {
  let calls = 0;
  const chain = {
    from() { return chain; },
    where() { return chain; },
    orderBy() { return chain; },
    limit() { return rowFactory(); },
  };
  const db = {
    select() { calls++; return chain; },
    update() { return { set() { return { where: async () => {} }; } }; },
  } as unknown as DrizzleTx;
  return { db, selectCalls: () => calls };
}

const noopQueue = { publish: vi.fn(async () => {}) } as unknown as Queue;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("startRelay backpressure", () => {
  it("runs only one cycle at a time while a cycle is still in flight", async () => {
    vi.useFakeTimers();
    // First fetch never resolves: the cycle stays in flight forever.
    const { db, selectCalls } = fakeDb(() => new Promise<unknown[]>(() => {}));
    const timer = startRelay(db, noopQueue, 500, "test");
    try {
      await vi.advanceTimersByTimeAsync(2600); // 5 ticks
      expect(
        selectCalls(),
        "later ticks must be skipped while the first cycle is still running",
      ).toBe(1);
    } finally {
      clearInterval(timer);
    }
  });

  it("runs again on the next tick once a fast cycle completes", async () => {
    vi.useFakeTimers();
    // Every fetch resolves immediately with no rows: each tick completes fast.
    const { db, selectCalls } = fakeDb(async () => []);
    const timer = startRelay(db, noopQueue, 500, "test");
    try {
      await vi.advanceTimersByTimeAsync(2600); // 5 ticks
      expect(
        selectCalls(),
        "a completed cycle must release the guard so the next tick runs",
      ).toBeGreaterThan(1);
    } finally {
      clearInterval(timer);
    }
  });
});
