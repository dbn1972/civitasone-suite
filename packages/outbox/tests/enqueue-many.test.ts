/**
 * enqueueMany() writes exactly the rows N x enqueue() would, in order, using
 * multi-row INSERTs (CLOS3-S6-15/16 batched audit events).
 */
import { describe, it, expect } from "vitest";
import { enqueue, enqueueMany, ENQUEUE_MANY_CHUNK, OUTBOX_CAUSATION_KEY, type DrizzleTx } from "../src/index.js";

function capture() {
  const calls: Array<Array<Record<string, unknown>>> = [];
  const db = {
    insert: () => ({ values: async (v: unknown) => { calls.push((Array.isArray(v) ? v : [v]) as Array<Record<string, unknown>>); } }),
  } as unknown as DrizzleTx;
  return { db, calls };
}
const ev = (i: number, extra: Record<string, unknown> = {}) => ({
  topic: "audit.event.record", eventType: "pii.access.logged", tenantId: "t", actorId: "a",
  correlationId: `c${i}`, payload: { i }, ...extra,
});

describe("enqueueMany", () => {
  it("produces the same rows as per-event enqueue(), in order, in one statement", async () => {
    const events = [ev(0), ev(1, { causationId: "cmd" }), ev(2, { schemaVersion: "9.9" })];
    const single = capture();
    for (const e of events) await enqueue(single.db, e);
    const many = capture();
    await enqueueMany(many.db, events);
    expect(many.calls).toHaveLength(1);
    expect(many.calls[0]).toEqual(single.calls.flat());
    expect(many.calls[0]![1]!.payload).toEqual({ i: 1, [OUTBOX_CAUSATION_KEY]: "cmd" });
  });
  it("chunks large batches and is a no-op for an empty list", async () => {
    const { db, calls } = capture();
    await enqueueMany(db, []);
    expect(calls).toHaveLength(0);
    await enqueueMany(db, Array.from({ length: ENQUEUE_MANY_CHUNK + 1 }, (_, i) => ev(i)));
    expect(calls.map((c) => c.length)).toEqual([ENQUEUE_MANY_CHUNK, 1]);
  });
});
