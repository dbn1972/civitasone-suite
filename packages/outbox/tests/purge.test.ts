/**
 * Req 6.3 (World-Class Closure, Workstream A — Database Hygiene):
 * `startOutboxPurge()` must run every 60 minutes (service call sites pass
 * intervalMs: 60 * 60_000), delete published outbox rows in batches of 1000,
 * and log a WARN when a purge cycle deletes zero rows while the outbox table
 * has more than 10,000 entries.
 *
 * These are pure unit tests against the shared `@civitasone/outbox` package
 * (the single implementation every one of the 30 DB-backed services wires via
 * `startOutboxPurge(db, { intervalMs: 60 * 60_000, batchSize: 1000, logger })`
 * in their `worker.ts`). No live Postgres is required — the Drizzle `db` is a
 * minimal fake exposing only `execute()`, called in the exact sequence
 * `purgeOutbox`/`startOutboxPurge` invoke it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { purgeOutbox, startOutboxPurge, type DrizzleTx } from "../src/index.js";

type ExecResult = { rowCount?: number } | { rows: Array<{ cnt: number }> };

/** Fake Drizzle handle: `execute()` returns queued results in call order. */
function fakeDb(results: ExecResult[]): DrizzleTx {
  let i = 0;
  const execute = vi.fn(async () => {
    const r = results[i] ?? { rowCount: 0 };
    i++;
    return r;
  });
  return { execute } as unknown as DrizzleTx;
}

describe("purgeOutbox — batched deletion", () => {
  it("accumulates deleted rows across batches and stops once a batch is under batchSize", async () => {
    // Outbox loop: 1000, 1000, 300 (3 calls, stops at 300 < 1000).
    // Inbox loop: 500 (1 call, stops at 500 < 1000).
    const db = fakeDb([
      { rowCount: 1000 },
      { rowCount: 1000 },
      { rowCount: 300 },
      { rowCount: 500 },
    ]);
    const total = await purgeOutbox(db, 7, 1000);
    expect(total).toBe(2300); // inbox deletions are not counted in the return value
    expect((db.execute as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(4);
  });

  it("performs exactly one batch per table when the first batch is already under batchSize", async () => {
    const db = fakeDb([{ rowCount: 42 }, { rowCount: 0 }]);
    const total = await purgeOutbox(db, 7, 1000);
    expect(total).toBe(42);
    expect((db.execute as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
  });

  it("returns 0 and issues no unnecessary work when nothing is eligible for deletion", async () => {
    const db = fakeDb([{ rowCount: 0 }, { rowCount: 0 }]);
    const total = await purgeOutbox(db, 7, 1000);
    expect(total).toBe(0);
  });
});

describe("startOutboxPurge — scheduled cycle + WARN threshold", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("logs a WARN when a cycle deletes zero rows and the outbox exceeds 10,000 entries", async () => {
    const logger = { warn: vi.fn() };
    // purgeOutbox: outbox loop (1 call, 0 deleted), inbox loop (1 call, 0 deleted).
    // Then the zero-deleted count check queries _outbox.messages.
    const db = fakeDb([
      { rowCount: 0 },
      { rowCount: 0 },
      { rows: [{ cnt: 15_000 }] },
    ]);

    const timer = startOutboxPurge(db, { intervalMs: 1000, batchSize: 1000, logger });
    // Advance timers and flush async: the interval callback is a void async IIFE
    // so we need multiple ticks for the dynamic import() + db.execute calls to resolve.
    await vi.advanceTimersByTimeAsync(1001);
    // Flush microtask queue repeatedly to let dynamic imports settle
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(1);
    }

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ outboxCount: 15_000, deleted: 0, retentionDays: 7 }),
      expect.stringContaining("outbox purge deleted zero rows"),
    );
    clearInterval(timer);
  });

  it("does not log a WARN when a cycle deletes zero rows but the outbox is at or under 10,000 entries", async () => {
    const logger = { warn: vi.fn() };
    const db = fakeDb([
      { rowCount: 0 },
      { rowCount: 0 },
      { rows: [{ cnt: 10_000 }] },
    ]);

    const timer = startOutboxPurge(db, { intervalMs: 1000, batchSize: 1000, logger });
    await vi.advanceTimersByTimeAsync(1000);

    expect(logger.warn).not.toHaveBeenCalled();
    clearInterval(timer);
  });

  it("does not log a WARN, and does not query the count, when a cycle deletes rows", async () => {
    const logger = { warn: vi.fn() };
    // Outbox loop deletes 500 (1 call, stop), inbox loop deletes 0 (1 call, stop).
    // No third call — the count check only runs when deleted === 0.
    const db = fakeDb([{ rowCount: 500 }, { rowCount: 0 }]);

    const timer = startOutboxPurge(db, { intervalMs: 1000, batchSize: 1000, logger });
    await vi.advanceTimersByTimeAsync(1001);
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(1);
    }

    expect(logger.warn).not.toHaveBeenCalled();
    expect((db.execute as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
    clearInterval(timer);
  });

  it("is a no-op (never throws, never warns) when no logger is supplied", async () => {
    const db = fakeDb([{ rowCount: 0 }, { rowCount: 0 }]);
    const timer = startOutboxPurge(db, { intervalMs: 1000, batchSize: 1000 });
    await expect(vi.advanceTimersByTimeAsync(1000)).resolves.not.toThrow();
    clearInterval(timer);
  });

  it("swallows purge failures so the scheduled loop keeps running", async () => {
    const logger = { warn: vi.fn() };
    const db = { execute: vi.fn().mockRejectedValue(new Error("db down")) } as unknown as DrizzleTx;
    const timer = startOutboxPurge(db, { intervalMs: 1000, batchSize: 1000, logger });
    await expect(vi.advanceTimersByTimeAsync(1000)).resolves.not.toThrow();
    expect(logger.warn).not.toHaveBeenCalled();
    clearInterval(timer);
  });

  it("defaults to a 60-minute interval and 1000-row batches when options are omitted", async () => {
    const db = fakeDb([{ rowCount: 0 }, { rowCount: 0 }]);
    const executeSpy = db.execute as ReturnType<typeof vi.fn>;
    const timer = startOutboxPurge(db);

    // Just under the 60-minute default interval: no cycle should have run yet.
    await vi.advanceTimersByTimeAsync(60 * 60_000 - 1);
    expect(executeSpy).not.toHaveBeenCalled();

    // Crossing the 60-minute mark triggers exactly one purge cycle
    // (outbox loop + inbox loop = 2 execute calls; deleted !== 0 so no count check).
    await vi.advanceTimersByTimeAsync(1);
    expect(executeSpy).toHaveBeenCalledTimes(2); // outbox delete loop + inbox delete loop; both return 0 rows so each loop stops after one call, and deleted===0 with no logger means no count query
    clearInterval(timer);
  });

  it("returns a timer that does not keep the event loop alive (unref'd)", () => {
    const db = fakeDb([{ rowCount: 0 }, { rowCount: 0 }]);
    const timer = startOutboxPurge(db, { intervalMs: 60_000 });
    expect(typeof (timer as unknown as { hasRef?: () => boolean }).hasRef).toBe("function");
    expect((timer as unknown as { hasRef: () => boolean }).hasRef()).toBe(false);
    clearInterval(timer);
  });

  it("stops running once the returned timer is cleared", async () => {
    const logger = { warn: vi.fn() };
    const db = fakeDb([{ rowCount: 0 }, { rowCount: 0 }, { rows: [{ cnt: 20_000 }] }]);
    const timer = startOutboxPurge(db, { intervalMs: 1000, batchSize: 1000, logger });
    clearInterval(timer);
    await vi.advanceTimersByTimeAsync(5000);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
