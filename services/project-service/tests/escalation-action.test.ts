/**
 * GAP-PROJECTS-ESCALATIONS-02 — escalation action workflow.
 *
 * acknowledge/reassign/clear must: seed a persisted action-state row on the
 * first action, enforce the status machine + optimistic-lock guard, and write
 * the audit event in the SAME transaction. These tests exercise the command
 * and consumer directly (same mock-of-the-tx pattern as board-intake-consumer
 * / disburse-reason) so they fail on the pre-workflow code (which had no
 * escalation module at all — escalations were a read-only projection).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const { mockTx, dbTransactionFn, enqueuedMessages, markProcessedMock, publish, repoMock } = vi.hoisted(() => {
  const _mockTx = {};
  return {
    mockTx: _mockTx,
    dbTransactionFn: vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); }) as any,
    enqueuedMessages: [] as Array<{ topic: string; payload: any }>,
    markProcessedMock: vi.fn(async () => true),
    publish: vi.fn(async () => undefined),
    repoMock: {
      findByProjectIdTx: vi.fn(),
      insertIdempotent: vi.fn(async () => true),
      transitionTx: vi.fn(async () => 1),
      listByProjectIdsTx: vi.fn(async () => []),
      listByTenant: vi.fn(async () => []),
    },
  };
});

vi.mock("../src/shared/db.js", () => ({ db: { transaction: dbTransactionFn } }));
vi.mock("@civitasone/db", () => ({
  runWithTenant: async (_t: string, fn: () => Promise<unknown>) => fn(),
  withTenantConsumer: (handler: (msg: unknown) => Promise<void>) => handler,
}));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: { topic: string; payload: unknown }) => { enqueuedMessages.push({ topic: msg.topic, payload: msg.payload }); }),
  markProcessed: (...a: any[]) => (markProcessedMock as any)(...a),
}));
vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: (...a: unknown[]) => (publish as any)(...a) },
  cache: { invalidate: vi.fn(async () => undefined), makeKey: (...p: string[]) => p.join(":") },
}));
vi.mock("../src/modules/escalation/repo.js", () => repoMock);

import { actOnEscalation } from "../src/modules/escalation/commands.js";
import { registerEscalationConsumers } from "../src/modules/escalation/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
const settle = () => new Promise<void>((r) => setTimeout(r, 100));

function publishAct(q: MemoryQueue, projectId: string, action: string, extra: Record<string, unknown> = {}) {
  return q.publish(COMMANDS.escalationAct, {
    messageId: randomUUID(), type: COMMANDS.escalationAct, tenantId: TENANT, actorId: ACTOR,
    correlationId: "c", schemaVersion: "1.0",
    payload: { projectId, tenantId: TENANT, action, reason: null, escalatedTo: null, severity: null, issue: null, ...extra },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  enqueuedMessages.length = 0;
  markProcessedMock.mockResolvedValue(true);
  repoMock.transitionTx.mockResolvedValue(1);
  repoMock.insertIdempotent.mockResolvedValue(true);
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
});

describe("escalation action command", () => {
  it("publishes action + reason + escalatedTo in the payload", async () => {
    const ctx = { tenantId: TENANT, actorId: ACTOR, correlationId: "c", roles: [] };
    const projectId = randomUUID();
    await actOnEscalation(ctx as never, projectId, "reassign", { escalatedTo: "Chief Engineer", reason: "owner change" });
    const msg = publish.mock.calls[0]![1] as { type: string; payload: Record<string, unknown> };
    expect(msg.type).toBe(COMMANDS.escalationAct);
    expect(msg.payload.action).toBe("reassign");
    expect(msg.payload.escalatedTo).toBe("Chief Engineer");
    expect(msg.payload.reason).toBe("owner change");
  });
});

describe("escalation action consumer (seed + status machine + audit in same tx)", () => {
  it("acknowledge seeds an open row then moves open → acknowledged and audits", async () => {
    const projectId = randomUUID();
    // No persisted row initially → consumer seeds it (open), then re-reads it.
    repoMock.findByProjectIdTx
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ projectId, status: "open", version: 1 });
    const q = new MemoryQueue(); registerEscalationConsumers(q); await q.start();
    await publishAct(q, projectId, "acknowledge", { severity: "blocked", issue: "Critical blocker" });
    await settle();
    expect(repoMock.insertIdempotent).toHaveBeenCalledOnce();
    const seeded = repoMock.insertIdempotent.mock.calls[0]![1] as Record<string, unknown>;
    expect(seeded.status).toBe("open");
    expect(seeded.severity).toBe("blocked");
    expect(repoMock.transitionTx).toHaveBeenCalledWith(
      mockTx, TENANT, projectId, "open", "acknowledged", ACTOR, 1, expect.objectContaining({ acknowledgedBy: ACTOR }),
    );
    const audit = enqueuedMessages.find((m) => m.topic === "audit.event.record");
    expect(audit?.payload.action).toBe("escalation_acknowledge");
    expect(audit?.payload.resourceType).toBe("escalation");
    expect(enqueuedMessages.find((m) => m.topic === EVENTS.escalationActioned)).toBeDefined();
    await q.stop();
  });

  it("clear moves acknowledged → cleared and records the reason", async () => {
    const projectId = randomUUID();
    repoMock.findByProjectIdTx.mockResolvedValue({ projectId, status: "acknowledged", version: 2 });
    const q = new MemoryQueue(); registerEscalationConsumers(q); await q.start();
    await publishAct(q, projectId, "clear", { reason: "Resolved on site" });
    await settle();
    expect(repoMock.insertIdempotent).not.toHaveBeenCalled(); // row already exists
    expect(repoMock.transitionTx).toHaveBeenCalledWith(
      mockTx, TENANT, projectId, "acknowledged", "cleared", ACTOR, 2, expect.objectContaining({ clearedBy: ACTOR, note: "Resolved on site" }),
    );
    const audit = enqueuedMessages.find((m) => m.topic === "audit.event.record");
    expect(audit?.payload.action).toBe("escalation_clear");
    expect(audit?.payload.reason).toBe("Resolved on site");
    await q.stop();
  });

  it("reassign keeps the status and only changes escalatedTo", async () => {
    const projectId = randomUUID();
    repoMock.findByProjectIdTx.mockResolvedValue({ projectId, status: "acknowledged", version: 3 });
    const q = new MemoryQueue(); registerEscalationConsumers(q); await q.start();
    await publishAct(q, projectId, "reassign", { escalatedTo: "Program Director" });
    await settle();
    expect(repoMock.transitionTx).toHaveBeenCalledWith(
      mockTx, TENANT, projectId, "acknowledged", "acknowledged", ACTOR, 3, expect.objectContaining({ escalatedTo: "Program Director" }),
    );
    const audit = enqueuedMessages.find((m) => m.topic === "audit.event.record");
    expect(audit?.payload.action).toBe("escalation_reassign");
    await q.stop();
  });

  it("is a no-op (no audit) when acknowledging an already-cleared escalation", async () => {
    const projectId = randomUUID();
    repoMock.findByProjectIdTx.mockResolvedValue({ projectId, status: "cleared", version: 5 });
    const q = new MemoryQueue(); registerEscalationConsumers(q); await q.start();
    await publishAct(q, projectId, "acknowledge");
    await settle();
    expect(repoMock.transitionTx).not.toHaveBeenCalled();
    expect(enqueuedMessages.find((m) => m.topic === "audit.event.record")).toBeUndefined();
    await q.stop();
  });

  it("is idempotent on duplicate delivery (markProcessed false → no work)", async () => {
    markProcessedMock.mockResolvedValue(false);
    const q = new MemoryQueue(); registerEscalationConsumers(q); await q.start();
    await publishAct(q, randomUUID(), "acknowledge");
    await settle();
    expect(repoMock.findByProjectIdTx).not.toHaveBeenCalled();
    expect(repoMock.transitionTx).not.toHaveBeenCalled();
    expect(enqueuedMessages).toHaveLength(0);
    await q.stop();
  });

  it("writes no audit when the optimistic-lock race is lost (transition updates 0 rows)", async () => {
    const projectId = randomUUID();
    repoMock.findByProjectIdTx.mockResolvedValue({ projectId, status: "open", version: 1 });
    repoMock.transitionTx.mockResolvedValue(0);
    const q = new MemoryQueue(); registerEscalationConsumers(q); await q.start();
    await publishAct(q, projectId, "acknowledge");
    await settle();
    expect(enqueuedMessages.find((m) => m.topic === "audit.event.record")).toBeUndefined();
    await q.stop();
  });
});
