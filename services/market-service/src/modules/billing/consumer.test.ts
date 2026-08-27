/**
 * Re-review regression test (PR #821 REQUEST CHANGES, MEDIUM finding (c)):
 *
 * generateDemand's route-level findByAllotmentAndMonth pre-check was
 * check-then-publish with no DB unique constraint and no re-check in the
 * consumer — two concurrent POST /v1/market/demands requests for the same
 * allotment+month could both pass the pre-check and both insert. The fix adds
 * a real UNIQUE index (market_demands_allotment_month_uidx) and has
 * insertDemand target it via onConflictDoNothing(). This test exercises that
 * atomic guard directly at the consumer level — the layer the pre-check alone
 * cannot protect — by simulating the second, losing writer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const { mockTx, dbTransactionFn, enqueuedMessages, insertDemandMock } = vi.hoisted(() => {
  const _mockTx = {};
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn as any,
    enqueuedMessages: [] as Array<{ topic: string; payload: unknown }>,
    insertDemandMock: vi.fn() as any,
  };
});

vi.mock("../../shared/db.js", () => ({ db: { transaction: dbTransactionFn } }));
vi.mock("../../shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: { topic: string; payload: unknown }) => { enqueuedMessages.push({ topic: msg.topic, payload: msg.payload }); }),
  markProcessed: vi.fn(async () => true),
}));
vi.mock("../../shared/audit.js", () => ({ writeAudit: vi.fn(async () => undefined) }));
vi.mock("./repo.js", () => ({
  insertDemand: (...a: unknown[]) => insertDemandMock(...a),
  updateStatus: vi.fn(async () => null),
}));

import { registerBillingConsumers } from "./consumer.js";
import { COMMANDS, EVENTS } from "../../topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
const ALLOTMENT_ID = "30000000-cccc-4000-8000-000000000001";

function makeMsg(payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type: COMMANDS.generateDemand, tenantId: TENANT, actorId: ACTOR,
    correlationId: `corr-${randomUUID()}`, schemaVersion: "1.0", payload,
  };
}
async function buildQueue(): Promise<MemoryQueue> {
  const q = new MemoryQueue();
  registerBillingConsumers(q);
  await q.start();
  return q;
}
const settle = () => new Promise<void>((r) => setTimeout(r, 100));
const demandPayload = { id: "40000000-dddd-4000-8000-000000000001", allotmentId: ALLOTMENT_ID, demandMonth: "2026-08", amountMinor: "500000", dueDate: "2026-08-10" };

beforeEach(() => {
  vi.clearAllMocks();
  enqueuedMessages.length = 0;
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
});

describe("generateDemand consumer — atomic duplicate guard", () => {
  it("fires demandGenerated and writes audit when insertDemand returns the new row", async () => {
    insertDemandMock.mockResolvedValue({ id: demandPayload.id, status: "generated" });
    const q = await buildQueue();
    await q.publish(COMMANDS.generateDemand, makeMsg(demandPayload));
    await settle();

    expect(enqueuedMessages).toHaveLength(1);
    expect(enqueuedMessages[0]?.topic).toBe(EVENTS.demandGenerated);
    await q.stop();
  });

  it("skips the event and audit write when onConflictDoNothing means insertDemand returns null (duplicate month)", async () => {
    // Simulates the losing side of a concurrent generate-demand race for the
    // same allotment+month: the unique index rejected the insert, Drizzle's
    // onConflictDoNothing turned that into an empty .returning() instead of a
    // thrown constraint-violation exception, and insertDemand surfaces that
    // as null.
    insertDemandMock.mockResolvedValue(null);
    const q = await buildQueue();
    await q.publish(COMMANDS.generateDemand, makeMsg(demandPayload));
    await settle();

    expect(insertDemandMock).toHaveBeenCalledOnce();
    expect(enqueuedMessages).toHaveLength(0);
    await q.stop();
  });
});
