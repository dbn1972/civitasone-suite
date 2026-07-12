/**
 * Board-decision HR intake consumer — mock-based unit tests.
 *
 * Covers: intake creation from a `meeting.decision.hr` message; idempotent
 * replay (same messageId, and same decisionId under a fresh messageId);
 * tenant scoping; and malformed-payload drop.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const { mockTx, dbTransactionFn, enqueuedMessages, insertMock, markProcessedMock, runWithTenantMock } = vi.hoisted(() => {
  const _mockTx = {};
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  const _enqueuedMessages: Array<{ topic: string; payload: any }> = [];
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn as any,
    enqueuedMessages: _enqueuedMessages,
    insertMock: vi.fn(async () => true),
    markProcessedMock: vi.fn(async () => true),
    runWithTenantMock: vi.fn(async (_tenantId: string, fn: () => Promise<unknown>) => fn()),
  };
});

vi.mock("../src/shared/db.js", () => ({ db: { transaction: dbTransactionFn } }));
vi.mock("@civitasone/db", () => ({ runWithTenant: (...a: any[]) => (runWithTenantMock as any)(...a) }));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: { topic: string; payload: unknown }) => { enqueuedMessages.push({ topic: msg.topic, payload: msg.payload }); }),
  markProcessed: (...a: any[]) => markProcessedMock(...a),
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: { invalidate: vi.fn(async () => undefined), makeKey: (...parts: string[]) => parts.join(":") },
}));
vi.mock("../src/modules/board-intake/repo.js", () => ({
  insertIntakeIdempotent: (...a: any[]) => insertMock(...a),
}));

import { registerBoardIntakeConsumers } from "../src/modules/board-intake/consumer.js";
import { CONSUMED_EVENTS } from "../src/topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
function makeMsg(payload: Record<string, unknown>, messageId = randomUUID()) {
  return {
    messageId, type: CONSUMED_EVENTS.boardDecisionHr, tenantId: TENANT, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0", payload,
  };
}
const settle = () => new Promise<void>((r) => setTimeout(r, 100));

beforeEach(() => {
  vi.clearAllMocks();
  enqueuedMessages.length = 0;
  markProcessedMock.mockResolvedValue(true);
  insertMock.mockResolvedValue(true);
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
  runWithTenantMock.mockImplementation(async (_t: string, fn: () => Promise<unknown>) => fn());
});

describe("meeting.decision.hr → board intake", () => {
  it("opens a pending_review intake item and emits audit", async () => {
    const q = new MemoryQueue(); registerBoardIntakeConsumers(q); await q.start();
    const decisionId = randomUUID();
    await q.publish(CONSUMED_EVENTS.boardDecisionHr, makeMsg({
      decisionId, meetingId: randomUUID(), text: "Regularise contractual staff per board resolution",
      authority: "Board of Governors",
    }));
    await settle();
    // runWithTenant used with the message tenant (RLS/tenant scoping backstop).
    expect(runWithTenantMock).toHaveBeenCalledWith(TENANT, expect.any(Function));
    // Intake inserted, scoped to the message tenant, in pending_review.
    expect(insertMock).toHaveBeenCalledOnce();
    const row = insertMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(row.tenantId).toBe(TENANT);
    expect(row.decisionId).toBe(decisionId);
    expect(row.status).toBe("pending_review");
    expect(row.source).toBe("meeting");
    // Audit published; NO auto-execution event.
    const audit = enqueuedMessages.find((m) => m.topic === "audit.event.record");
    expect(audit).toBeDefined();
    expect(audit!.payload.action).toBe("intake_open");
    expect(audit!.payload.resourceType).toBe("board_decision_intake");
    await q.stop();
  });

  it("is idempotent on duplicate delivery (same messageId → markProcessed false)", async () => {
    markProcessedMock.mockResolvedValue(false);
    const q = new MemoryQueue(); registerBoardIntakeConsumers(q); await q.start();
    await q.publish(CONSUMED_EVENTS.boardDecisionHr, makeMsg({
      decisionId: randomUUID(), meetingId: randomUUID(), text: "x",
    }));
    await settle();
    expect(insertMock).not.toHaveBeenCalled();
    expect(enqueuedMessages).toHaveLength(0);
    await q.stop();
  });

  it("is idempotent on re-published decision (fresh messageId, ON CONFLICT no-op → no audit)", async () => {
    insertMock.mockResolvedValue(false); // (tenant, decision) already present
    const q = new MemoryQueue(); registerBoardIntakeConsumers(q); await q.start();
    await q.publish(CONSUMED_EVENTS.boardDecisionHr, makeMsg({
      decisionId: randomUUID(), meetingId: randomUUID(), text: "duplicate decision",
    }));
    await settle();
    expect(insertMock).toHaveBeenCalledOnce();
    const audit = enqueuedMessages.find((m) => m.topic === "audit.event.record");
    expect(audit).toBeUndefined();
    await q.stop();
  });

  it("drops a malformed payload (missing decisionId/text)", async () => {
    const q = new MemoryQueue(); registerBoardIntakeConsumers(q); await q.start();
    await q.publish(CONSUMED_EVENTS.boardDecisionHr, makeMsg({ meetingId: randomUUID() }));
    await settle();
    expect(markProcessedMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    await q.stop();
  });
});
