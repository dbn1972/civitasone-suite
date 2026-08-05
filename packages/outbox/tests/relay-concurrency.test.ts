/**
 * Relay concurrency (throughput fix).
 *
 * The old relayOnce published its batch strictly sequentially: every publish
 * paid a full SQS round-trip before the next began, so a 100-row batch took 100
 * serial round-trips and drained far slower than events arrived. relayOnce now
 * publishes with BOUNDED CONCURRENCY (wave size = concurrency, default 20) via
 * Promise.allSettled. These tests prove:
 *   - the batch is published in parallel waves, not N serial round-trips;
 *   - the configured concurrency cap is never exceeded (so the SQS socket pool
 *     is not overrun by an unbounded fan-out of the whole batch);
 *   - per-row isolation: one row's publish failure is counted + captured and
 *     never aborts the batch or blocks its peers;
 *   - only rows whose publish SUCCEEDED are marked published, in a single
 *     batched UPDATE;
 *   - the idempotent envelope (messageId = row.id + stable fields) is preserved.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock observability so failure counting/capturing is observable in tests.
const obs = vi.hoisted(() => ({
  incrementOutboxRelayFailure: vi.fn(),
  captureError: vi.fn(),
}));
vi.mock("@civitasone/observability", () => ({
  incrementOutboxRelayFailure: obs.incrementOutboxRelayFailure,
  captureError: obs.captureError,
}));

// Spy on drizzle's inArray to capture the exact ids passed to the batched
// mark-published UPDATE, while delegating to the real implementation.
const cap = vi.hoisted(() => ({ inArrayCalls: [] as string[][] }));
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    inArray: (col: unknown, vals: string[]) => {
      cap.inArrayCalls.push(vals);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (actual.inArray as any)(col, vals);
    },
  };
});

// eslint-disable-next-line import/first
import { relayOnce, resolveRelayConcurrency, DEFAULT_OUTBOX_RELAY_CONCURRENCY, type DrizzleTx } from "../src/index.js";

type Queue = Parameters<typeof relayOnce>[1];

interface Row {
  id: string;
  topic: string;
  eventType: string;
  tenantId: string;
  actorId: string;
  correlationId: string;
  payload: Record<string, unknown>;
}

function makeRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `id-${i}`,
    topic: `topic.${i % 3}`,
    eventType: "some.event",
    tenantId: `tenant-${i}`,
    actorId: `actor-${i}`,
    correlationId: `corr-${i}`,
    payload: { i },
  }));
}

/** Fake Drizzle handle: select() returns the given rows; update() is a no-op
 *  chain (the ids marked published are captured via the mocked inArray). */
function makeDb(rows: Row[]): { db: DrizzleTx; updateCalls: () => number } {
  let updateCalls = 0;
  const db = {
    select() {
      return { from() { return { where() { return { orderBy() { return { limit: async () => rows }; } }; } }; } };
    },
    update() {
      updateCalls++;
      return { set() { return { where: async () => {} }; } };
    },
  } as unknown as DrizzleTx;
  return { db, updateCalls: () => updateCalls };
}

/** Fake queue whose publish resolves after `delayMs`, tracks peak concurrency,
 *  and throws for any messageId in `failIds`. */
function makeQueue(delayMs: number, failIds: Set<string> = new Set()) {
  let inFlight = 0;
  let maxInFlight = 0;
  const publishedIds: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const publish = vi.fn(async (_topic: string, input: any) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise((r) => setTimeout(r, delayMs));
      if (failIds.has(input.messageId)) throw new Error(`boom ${input.messageId}`);
      publishedIds.push(input.messageId);
      return input.messageId;
    } finally {
      inFlight--;
    }
  });
  const queue = { publish } as unknown as Queue;
  return { queue, publish, maxInFlight: () => maxInFlight, publishedIds };
}

beforeEach(() => {
  obs.incrementOutboxRelayFailure.mockClear();
  obs.captureError.mockClear();
  cap.inArrayCalls.length = 0;
});

describe("resolveRelayConcurrency", () => {
  it("defaults to 20 when unset/malformed/non-positive", () => {
    expect(resolveRelayConcurrency(undefined)).toBe(DEFAULT_OUTBOX_RELAY_CONCURRENCY);
    expect(resolveRelayConcurrency("")).toBe(20);
    expect(resolveRelayConcurrency("nonsense")).toBe(20);
    expect(resolveRelayConcurrency("0")).toBe(20);
    expect(resolveRelayConcurrency("-5")).toBe(20);
  });
  it("honours a valid positive override", () => {
    expect(resolveRelayConcurrency("5")).toBe(5);
    expect(resolveRelayConcurrency("50")).toBe(50);
  });
});

describe("relayOnce bounded-concurrency publishing", () => {
  it("publishes the batch in parallel waves, not N serial round-trips", async () => {
    const rows = makeRows(100);
    const { db } = makeDb(rows);
    const { queue, publish, maxInFlight, publishedIds } = makeQueue(20);

    const started = Date.now();
    const count = await relayOnce(db, queue, 100, "test"); // default concurrency = 20
    const elapsed = Date.now() - started;

    expect(count).toBe(100);
    expect(publishedIds).toHaveLength(100);
    expect(publish).toHaveBeenCalledTimes(100);
    // Peak concurrency proves parallelism (>1) AND respects the default cap (20).
    expect(maxInFlight()).toBe(20);
    // 100 rows / 20 concurrency = 5 waves * ~20ms ~= 100ms; strictly sequential
    // would be 100 * 20ms = 2000ms. Generous ceiling avoids CI flake.
    expect(elapsed).toBeLessThan(800);
  });

  it("never exceeds a lower configured concurrency cap", async () => {
    const rows = makeRows(20);
    const { db } = makeDb(rows);
    const { queue, maxInFlight } = makeQueue(15);

    const count = await relayOnce(db, queue, 100, "test", 5);

    expect(count).toBe(20);
    expect(maxInFlight()).toBe(5); // capped at 5, never a full 20-wide fan-out
  });

  it("isolates a per-row publish failure: peers still publish, failure is counted + captured", async () => {
    const rows = makeRows(10);
    const { db } = makeDb(rows);
    const { queue, publishedIds } = makeQueue(5, new Set(["id-3"]));

    const count = await relayOnce(db, queue, 100, "test");

    expect(count).toBe(9); // the one poison row is skipped, batch not aborted
    expect(publishedIds).toHaveLength(9);
    expect(publishedIds).not.toContain("id-3");
    // Failure observable with the exact fields.
    expect(obs.incrementOutboxRelayFailure).toHaveBeenCalledTimes(1);
    expect(obs.incrementOutboxRelayFailure).toHaveBeenCalledWith("test");
    expect(obs.captureError).toHaveBeenCalledTimes(1);
    const [, ctx] = obs.captureError.mock.calls[0];
    expect(ctx).toMatchObject({
      service: "test",
      topic: "topic.0", // id-3 -> i=3 -> topic.(3%3)=topic.0
      correlationId: "corr-3",
      event: "outbox_relay_failed",
      outboxId: "id-3",
    });
  });

  it("marks ONLY successfully-published rows, in a single batched UPDATE", async () => {
    const rows = makeRows(10);
    const { db, updateCalls } = makeDb(rows);
    const { queue } = makeQueue(2, new Set(["id-7"]));

    const count = await relayOnce(db, queue, 100, "test");

    expect(count).toBe(9);
    // Exactly one batched UPDATE (not N per-row updates).
    expect(updateCalls()).toBe(1);
    expect(cap.inArrayCalls).toHaveLength(1);
    const marked = cap.inArrayCalls[0];
    expect(marked).toHaveLength(9);
    expect(marked).not.toContain("id-7"); // failed row is NOT marked published
    expect(new Set(marked)).toEqual(
      new Set(rows.map((r) => r.id).filter((id) => id !== "id-7")),
    );
  });

  it("preserves the idempotent envelope: messageId = row.id + stable fields", async () => {
    const rows = makeRows(3);
    const { db } = makeDb(rows);
    const { queue, publish } = makeQueue(1);

    await relayOnce(db, queue, 100, "test");

    expect(publish).toHaveBeenCalledTimes(3);
    for (const row of rows) {
      const call = publish.mock.calls.find((c) => c[1].messageId === row.id);
      expect(call, `publish for ${row.id}`).toBeDefined();
      const [topic, envelope] = call!;
      expect(topic).toBe(row.topic);
      expect(envelope).toEqual({
        messageId: row.id, // SEC C1 stable-id dedup preserved
        type: row.eventType,
        tenantId: row.tenantId,
        actorId: row.actorId,
        correlationId: row.correlationId,
        schemaVersion: "1.0",
        payload: row.payload,
      });
    }
  });

  it("does not touch the DB update when there are no unsent rows", async () => {
    const { db, updateCalls } = makeDb([]);
    const { queue, publish } = makeQueue(1);

    const count = await relayOnce(db, queue, 100, "test");

    expect(count).toBe(0);
    expect(publish).not.toHaveBeenCalled();
    expect(updateCalls()).toBe(0);
    expect(cap.inArrayCalls).toHaveLength(0);
  });

  it("marks all rows published when every publish succeeds", async () => {
    const rows = makeRows(45); // spans multiple waves at default concurrency 20
    const { db, updateCalls } = makeDb(rows);
    const { queue, publishedIds } = makeQueue(1);

    const count = await relayOnce(db, queue, 100, "test");

    expect(count).toBe(45);
    expect(publishedIds).toHaveLength(45);
    expect(obs.incrementOutboxRelayFailure).not.toHaveBeenCalled();
    expect(updateCalls()).toBe(1);
    expect(cap.inArrayCalls[0]).toHaveLength(45);
  });
});
