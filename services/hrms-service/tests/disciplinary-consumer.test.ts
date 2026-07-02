/**
 * Disciplinary consumer unit tests — mock-based.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const { mockTx, dbTransactionFn, enqueuedMessages, findCaseMock, transitionCaseMock, appendEventMock } = vi.hoisted(() => {
  const _mockTx = { insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }) };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  const _enqueuedMessages: Array<{ topic: string; payload: unknown }> = [];
  return {
    mockTx: _mockTx, dbTransactionFn: _dbTransactionFn as any,
    enqueuedMessages: _enqueuedMessages,
    findCaseMock: vi.fn(async () => ({ status: "finding_recorded" })),
    transitionCaseMock: vi.fn(async () => ({ id: "x", status: "pending_approval" })),
    appendEventMock: vi.fn(async () => undefined),
  };
});

vi.mock("../src/shared/db.js", () => ({ db: { transaction: dbTransactionFn } }));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: { topic: string; payload: unknown }) => { enqueuedMessages.push({ topic: msg.topic, payload: msg.payload }); }),
  markProcessed: vi.fn(async () => true),
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: { invalidate: vi.fn(async () => undefined), makeKey: (...parts: string[]) => parts.join(":") },
}));
vi.mock("../src/modules/disciplinary/repo.js", () => ({
  findCase: (...a: any[]) => findCaseMock(...a),
  transitionCase: (...a: any[]) => transitionCaseMock(...a),
  appendEvent: (...a: any[]) => appendEventMock(...a),
}));

import { registerDisciplinaryConsumers } from "../src/modules/disciplinary/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}
const settle = () => new Promise<void>((r) => setTimeout(r, 100));

beforeEach(() => { vi.clearAllMocks(); enqueuedMessages.length = 0; dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); }); });

describe("disciplinarySubmitApproval command", () => {
  it("transitions case to pending_approval and appends event", async () => {
    const q = new MemoryQueue(); registerDisciplinaryConsumers(q); await q.start();
    const caseId = randomUUID();
    await q.publish(COMMANDS.disciplinarySubmitApproval, makeMsg(COMMANDS.disciplinarySubmitApproval, {
      caseId, tenantId: TENANT, penaltyType: "dismissal", penaltyClass: "major",
      penaltyDate: "2026-06-01",
    }));
    await settle();
    expect(transitionCaseMock).toHaveBeenCalledOnce();
    expect(appendEventMock).toHaveBeenCalledOnce();
    const evt = appendEventMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(evt.toStatus).toBe("pending_approval");
    expect(evt.action).toBe("submit_for_approval");
    // Audit published
    const audit = enqueuedMessages.find((m) => m.topic === "audit.event.record");
    expect(audit).toBeDefined();
    await q.stop();
  });

  it("no-op when transitionCase returns null (status guard)", async () => {
    transitionCaseMock.mockResolvedValue(null);
    const q = new MemoryQueue(); registerDisciplinaryConsumers(q); await q.start();
    await q.publish(COMMANDS.disciplinarySubmitApproval, makeMsg(COMMANDS.disciplinarySubmitApproval, {
      caseId: randomUUID(), tenantId: TENANT, penaltyType: "censure", penaltyClass: "minor",
      penaltyDate: "2026-06-01",
    }));
    await settle();
    expect(appendEventMock).not.toHaveBeenCalled();
    await q.stop();
  });
});
