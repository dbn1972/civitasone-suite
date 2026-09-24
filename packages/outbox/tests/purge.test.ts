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
 *
 * G-ASYNC-1: `purgeOutbox` now runs a THIRD batched delete loop, for
 * `_inbox.command_results` (same retention window, same batching), after the
 * existing outbox and inbox/processed loops — every `fakeDb([...])` queue
 * below has a matching entry for it, and every `toHaveBeenCalledTimes(N)`
 * assertion is N+1 versus this file's pre-G-ASYNC-1 history.
 *
 * REL-029: the count-check branch's fixtures below (`[{ cnt: N }]`) must be a
 * bare array, matching the real shape drizzle's postgres-js driver returns
 * for a raw `db.execute()` SELECT. An earlier version of this file mocked
 * that call as `{ rows: [{ cnt: N }] }` — a shape the real driver never
 * returns — which is exactly why these unit tests kept passing while the
 * production code's `.rows?.[0]?.cnt` read silently always fell through to
 * `?? 0` against the real driver. See `purge-live-pg.test.ts` for the
 * live-Postgres regression coverage that catches that class of bug (a
 * mocked-but-wrong return shape) directly.
 *
 * REL-034: the same class of bug existed on the DELETE side. These fixtures
 * used to mock `{ rowCount: N }` (the node-postgres convention) while the
 * production code also (incorrectly) read `.rowCount` -- so, exactly as
 * with REL-029, the tests kept passing while validating the wrong shape.
 * postgres-js's real DELETE result exposes the affected-row count as
 * `.count`, never `.rowCount`; fixtures below now use `{ count: N }` to
 * match.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { purgeOutbox, startOutboxPurge, type DrizzleTx } from "../src/index.js";

type ExecResult = { count?: number } | Array<{ cnt: number }>;

/** Fake Drizzle handle: `execute()` returns queued results in call order. */
function fakeDb(results: ExecResult[]): DrizzleTx {
  let i = 0;
  const execute = vi.fn(async () => {
    const r = results[i] ?? { count: 0 };
    i++;
    return r;
  });
  return { execute } as unknown as DrizzleTx;
}

describe("purgeOutbox — batched deletion", () => {
  it("accumulates deleted rows across batches and stops once a batch is under batchSize", async () => {
    // Outbox loop: 1000, 1000, 300 (3 calls, stops at 300 < 1000).
    // Inbox loop: 500 (1 call, stops at 500 < 1000).
    // Command-results loop (G-ASYNC-1): 1000, 200 (2 calls, stops at 200 < 1000)
    // — given its own multi-batch scenario here, not just a trailing zero, so
    // this test actually exercises the third loop's do/while continuation,
    // not merely its presence.
    const db = fakeDb([
      { count: 1000 },
      { count: 1000 },
      { count: 300 },
      { count: 500 },
      { count: 1000 },
      { count: 200 },
    ]);
    const total = await purgeOutbox(db, 7, 1000);
    expect(total).toBe(4000); // REL-034: inbox + command_results deletions are both included
    expect((db.execute as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(6);
  });

  it("performs exactly one batch per table when the first batch is already under batchSize", async () => {
    // Third value (7) is deliberately non-zero so this asserts the
    // command_results loop's contribution is actually summed, not just that
    // a third call happens.
    const db = fakeDb([{ count: 42 }, { count: 0 }, { count: 7 }]);
    const total = await purgeOutbox(db, 7, 1000);
    expect(total).toBe(49);
    expect((db.execute as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(3);
  });

  it("returns 0 and issues no unnecessary work when nothing is eligible for deletion", async () => {
    const db = fakeDb([{ count: 0 }, { count: 0 }, { count: 0 }]);
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
    // purgeOutbox: outbox loop (1 call, 0 deleted), inbox loop (1 call, 0
    // deleted), command_results loop (1 call, 0 deleted — G-ASYNC-1). Then
    // the zero-deleted count check queries _outbox.messages.
    const db = fakeDb([
      { count: 0 },
      { count: 0 },
      { count: 0 },
      [{ cnt: 15_000 }],
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
      { count: 0 },
      { count: 0 },
      { count: 0 },
      [{ cnt: 10_000 }],
    ]);

    const timer = startOutboxPurge(db, { intervalMs: 1000, batchSize: 1000, logger });
    await vi.advanceTimersByTimeAsync(1000);

    expect(logger.warn).not.toHaveBeenCalled();
    clearInterval(timer);
  });

  it("does not log a WARN, and does not query the count, when a cycle deletes rows", async () => {
    const logger = { warn: vi.fn() };
    // Outbox loop deletes 500 (1 call, stop), inbox loop deletes 0 (1 call,
    // stop), command_results loop deletes 0 (1 call, stop — G-ASYNC-1).
    // No 4th call — the count check only runs when the TOTAL deleted === 0,
    // and outbox's 500 alone already makes that false.
    const db = fakeDb([{ count: 500 }, { count: 0 }, { count: 0 }]);

    const timer = startOutboxPurge(db, { intervalMs: 1000, batchSize: 1000, logger });
    await vi.advanceTimersByTimeAsync(1001);
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(1);
    }

    expect(logger.warn).not.toHaveBeenCalled();
    expect((db.execute as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(3);
    clearInterval(timer);
  });

  it("is a no-op (never throws, never warns) when no logger is supplied", async () => {
    const db = fakeDb([{ count: 0 }, { count: 0 }, { count: 0 }]);
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
    const db = fakeDb([{ count: 0 }, { count: 0 }, { count: 0 }]);
    const executeSpy = db.execute as ReturnType<typeof vi.fn>;
    const timer = startOutboxPurge(db);

    // Just under the 60-minute default interval: no cycle should have run yet.
    await vi.advanceTimersByTimeAsync(60 * 60_000 - 1);
    expect(executeSpy).not.toHaveBeenCalled();

    // Crossing the 60-minute mark triggers exactly one purge cycle (outbox
    // loop + inbox loop + command_results loop [G-ASYNC-1] = 3 execute
    // calls; all return 0 rows so each loop stops after one call, and
    // deleted===0 with no logger means no count query either).
    await vi.advanceTimersByTimeAsync(1);
    expect(executeSpy).toHaveBeenCalledTimes(3);
    clearInterval(timer);
  });

  it("returns a timer that does not keep the event loop alive (unref'd)", () => {
    const db = fakeDb([{ count: 0 }, { count: 0 }]);
    const timer = startOutboxPurge(db, { intervalMs: 60_000 });
    expect(typeof (timer as unknown as { hasRef?: () => boolean }).hasRef).toBe("function");
    expect((timer as unknown as { hasRef: () => boolean }).hasRef()).toBe(false);
    clearInterval(timer);
  });

  it("stops running once the returned timer is cleared", async () => {
    const logger = { warn: vi.fn() };
    const db = fakeDb([{ count: 0 }, { count: 0 }, [{ cnt: 20_000 }]]);
    const timer = startOutboxPurge(db, { intervalMs: 1000, batchSize: 1000, logger });
    clearInterval(timer);
    await vi.advanceTimersByTimeAsync(5000);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
