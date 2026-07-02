/**
 * Appraisals consumer unit tests — mock-based.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const { mockTx, dbTransactionFn, enqueuedMessages, insertAppraisalMock, updateAppraisalMock, findByIdMock } = vi.hoisted(() => {
  const _mockTx = { insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }) };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  const _enqueuedMessages: Array<{ topic: string; payload: unknown }> = [];
  return {
    mockTx: _mockTx, dbTransactionFn: _dbTransactionFn as any,
    enqueuedMessages: _enqueuedMessages,
    insertAppraisalMock: vi.fn(async () => undefined),
    updateAppraisalMock: vi.fn(async () => undefined),
    findByIdMock: vi.fn(async () => ({ id: "x", rating: "good" })),
  };
});

vi.mock("../src/shared/db.js", () => ({ db: { transaction: dbTransactionFn } }));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: { topic: string; payload: unknown }) => { enqueuedMessages.push({ topic: msg.topic, payload: msg.payload }); }),
  markProcessed: vi.fn(async () => true),
}));
vi.mock("../src/modules/appraisals/repo.js", () => ({
  insertAppraisal: (...a: any[]) => insertAppraisalMock(...a),
  updateAppraisal: (...a: any[]) => updateAppraisalMock(...a),
  findById: (...a: any[]) => findByIdMock(...a),
}));

import { registerAppraisalConsumers } from "../src/modules/appraisals/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}
const settle = () => new Promise<void>((r) => setTimeout(r, 100));

beforeEach(() => { vi.clearAllMocks(); enqueuedMessages.length = 0; dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); }); });

describe("appraisalCreate command", () => {
  it("inserts appraisal with default status", async () => {
    const q = new MemoryQueue(); registerAppraisalConsumers(q); await q.start();
    const id = randomUUID();
    await q.publish(COMMANDS.appraisalCreate, makeMsg(COMMANDS.appraisalCreate, {
      id, tenantId: TENANT, employeeId: randomUUID(),
      appraisalPeriod: "2025-26", reviewerId: null, status: "self_pending",
    }));
    await settle();
    expect(insertAppraisalMock).toHaveBeenCalledOnce();
    const row = insertAppraisalMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(row.status).toBe("self_pending");
    await q.stop();
  });
});

describe("appraisalAdvanceStage command", () => {
  it("updates appraisal stage and rating", async () => {
    const q = new MemoryQueue(); registerAppraisalConsumers(q); await q.start();
    const id = randomUUID();
    findByIdMock.mockResolvedValue({ id, rating: "outstanding" });
    await q.publish(COMMANDS.appraisalAdvanceStage, makeMsg(COMMANDS.appraisalAdvanceStage, {
      id, tenantId: TENANT, stage: "reviewer_completed", rating: "very_good",
    }));
    await settle();
    expect(updateAppraisalMock).toHaveBeenCalledOnce();
    const [, , patch] = updateAppraisalMock.mock.calls[0]! as [unknown, string, Record<string, unknown>];
    expect(patch.status).toBe("reviewer_completed");
    expect(patch.rating).toBe("very_good");
    await q.stop();
  });

  it("keeps existing rating if none provided in payload", async () => {
    const q = new MemoryQueue(); registerAppraisalConsumers(q); await q.start();
    const id = randomUUID();
    findByIdMock.mockResolvedValue({ id, rating: "outstanding" });
    await q.publish(COMMANDS.appraisalAdvanceStage, makeMsg(COMMANDS.appraisalAdvanceStage, {
      id, tenantId: TENANT, stage: "accepted", rating: null,
    }));
    await settle();
    const [, , patch] = updateAppraisalMock.mock.calls[0]! as [unknown, string, Record<string, unknown>];
    expect(patch.rating).toBe("outstanding"); // preserved from existing
    await q.stop();
  });
});
