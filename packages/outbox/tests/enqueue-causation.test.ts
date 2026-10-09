/**
 * FF-01 slice A (C1) — enqueue() gains an optional causationId that travels to
 * the delivered ENVELOPE without a new _outbox.messages column.
 *
 * Design: 03-designs/FF-01.md §0 item 6, §2.6. enqueue() stashes the id under
 * the reserved payload key OUTBOX_CAUSATION_KEY; relayOnce() lifts it onto the
 * envelope's top-level causationId and strips it from the delivered payload.
 * Omitting causationId (every existing call site) must leave both the stored
 * payload and the published envelope byte-for-byte unchanged.
 */
import { describe, it, expect, vi } from "vitest";
import { enqueue, relayOnce, OUTBOX_CAUSATION_KEY, type DrizzleTx } from "../src/index.js";
import type { Queue } from "@civitasone/queue";

vi.mock("@civitasone/observability", () => ({
  incrementOutboxRelayFailure: vi.fn(),
  captureError: vi.fn(),
}));

/** Capture the row object enqueue() inserts. */
function captureInsertDb() {
  const inserted: Array<Record<string, unknown>> = [];
  const db = {
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        inserted.push(row);
      },
    }),
  } as unknown as DrizzleTx;
  return { db, inserted };
}

/** A db whose unpublished-row select returns exactly `rows`, and records marks. */
function relayDb(rows: Array<Record<string, unknown>>) {
  const db = {
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => rows }) }) }) }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  } as unknown as DrizzleTx;
  return db;
}

describe("enqueue causationId", () => {
  it("omitting causationId leaves the stored payload unchanged (no reserved key)", async () => {
    const { db, inserted } = captureInsertDb();
    await enqueue(db, {
      topic: "finance.bill.create",
      eventType: "finance.bill.create",
      tenantId: "t",
      actorId: "a",
      correlationId: "c",
      payload: { billId: "9", amountMinor: "500000", currency: "INR" },
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.payload).toEqual({ billId: "9", amountMinor: "500000", currency: "INR" });
    expect(inserted[0]!.payload).not.toHaveProperty(OUTBOX_CAUSATION_KEY);
  });

  it("stashes a supplied causationId under the reserved key in the stored payload", async () => {
    const { db, inserted } = captureInsertDb();
    await enqueue(db, {
      topic: "finance.gl.post",
      eventType: "finance.gl.post",
      tenantId: "t",
      actorId: "a",
      correlationId: "c",
      payload: { journalId: "7" },
      causationId: "cmd-123",
    });
    expect(inserted[0]!.payload).toEqual({ journalId: "7", [OUTBOX_CAUSATION_KEY]: "cmd-123" });
  });
});

describe("relayOnce causationId", () => {
  it("lifts the stashed causationId onto the envelope and strips it from the delivered payload", async () => {
    const published: Array<{ topic: string; input: Record<string, unknown> }> = [];
    const queue = {
      publish: vi.fn(async (topic: string, input: Record<string, unknown>) => {
        published.push({ topic, input });
        return input.messageId as string;
      }),
    } as unknown as Queue;

    const db = relayDb([
      {
        id: "11111111-1111-1111-1111-111111111111",
        topic: "finance.gl.post",
        eventType: "finance.gl.post",
        tenantId: "t",
        actorId: "a",
        correlationId: "c",
        schemaVersion: "1.0",
        payload: { journalId: "7", [OUTBOX_CAUSATION_KEY]: "cmd-123" },
      },
    ]);

    await relayOnce(db, queue, 10, "finance-service", 1);

    expect(published).toHaveLength(1);
    expect(published[0]!.input.causationId).toBe("cmd-123");
    // Delivered payload is clean — no reserved key leaks to consumers.
    expect(published[0]!.input.payload).toEqual({ journalId: "7" });
    expect(published[0]!.input.payload).not.toHaveProperty(OUTBOX_CAUSATION_KEY);
  });

  it("leaves the envelope causationId undefined and the payload intact for a row with no stash", async () => {
    const published: Array<{ topic: string; input: Record<string, unknown> }> = [];
    const queue = {
      publish: vi.fn(async (topic: string, input: Record<string, unknown>) => {
        published.push({ topic, input });
        return input.messageId as string;
      }),
    } as unknown as Queue;

    const db = relayDb([
      {
        id: "22222222-2222-2222-2222-222222222222",
        topic: "finance.bill.create",
        eventType: "finance.bill.create",
        tenantId: "t",
        actorId: "a",
        correlationId: "c",
        schemaVersion: "1.0",
        payload: { billId: "9" },
      },
    ]);

    await relayOnce(db, queue, 10, "finance-service", 1);

    expect(published[0]!.input).not.toHaveProperty("causationId");
    expect(published[0]!.input.payload).toEqual({ billId: "9" });
  });
});
