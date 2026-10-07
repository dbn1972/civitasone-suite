/**
 * GAP-PROJECTS-DPR-TRACKING-01 — DPR review workflow.
 *
 * The submit→review→approve|return transition must: validate at the route
 * boundary, carry the action+reason into the command payload, enforce the
 * status machine + optimistic-lock guard in the consumer, and write the audit
 * event in the SAME transaction. These tests exercise the validator, command
 * and consumer directly (same mock-of-the-tx pattern the existing
 * disburse-reason.test.ts uses) so they fail on the pre-workflow code (which
 * had no dprTransition command/consumer at all).
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
      findDprByProjectAndDate: vi.fn(),
      insertDpr: vi.fn(async () => undefined),
      findDprByIdTx: vi.fn(),
      transitionDprTx: vi.fn(async () => 1),
    },
  };
});

vi.mock("../src/shared/db.js", () => ({ db: { transaction: dbTransactionFn } }));
vi.mock("@civitasone/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@civitasone/db")>();
  return {
    ...actual,
    runWithTenant: async (_t: string, fn: () => Promise<unknown>) => fn(),
    withTenantConsumer: (handler: (msg: unknown) => Promise<void>) => handler,
  };
});
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: { topic: string; payload: unknown }) => { enqueuedMessages.push({ topic: msg.topic, payload: msg.payload }); }),
  markProcessed: (...a: any[]) => (markProcessedMock as any)(...a),
}));
vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: (...a: unknown[]) => (publish as any)(...a) },
  cache: { invalidate: vi.fn(async () => undefined), makeKey: (...p: string[]) => p.join(":") },
}));
vi.mock("../src/modules/progress/repo.js", () => repoMock);

import { dprTransitionBody } from "../src/modules/progress/validators.js";
import { transitionDpr } from "../src/modules/progress/commands.js";
import { registerProgressConsumers } from "../src/modules/progress/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
const settle = () => new Promise<void>((r) => setTimeout(r, 100));

function publishTransition(q: MemoryQueue, dprId: string, projectId: string, action: string, reason?: string) {
  return q.publish(COMMANDS.dprTransition, {
    messageId: randomUUID(), type: COMMANDS.dprTransition, tenantId: TENANT, actorId: ACTOR,
    correlationId: "c", schemaVersion: "1.0",
    payload: { dprId, tenantId: TENANT, projectId, action, reason: reason ?? null },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  enqueuedMessages.length = 0;
  markProcessedMock.mockResolvedValue(true);
  repoMock.transitionDprTx.mockResolvedValue(1);
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
});

describe("DPR transition validator", () => {
  it("accepts review/approve/return and keeps the reason", () => {
    expect(dprTransitionBody.parse({ action: "review" })).toEqual({ action: "review" });
    expect(dprTransitionBody.parse({ action: "return", reason: "Revise cost estimate" }))
      .toEqual({ action: "return", reason: "Revise cost estimate" });
  });
  it("rejects an unknown action and a blank/oversized reason", () => {
    expect(dprTransitionBody.safeParse({ action: "delete" }).success).toBe(false);
    expect(dprTransitionBody.safeParse({ action: "return", reason: "   " }).success).toBe(false);
    expect(dprTransitionBody.safeParse({ action: "approve", reason: "x".repeat(501) }).success).toBe(false);
  });
});

describe("DPR transition command", () => {
  it("publishes the action and reason in the payload", async () => {
    const ctx = { tenantId: TENANT, actorId: ACTOR, correlationId: "c", roles: [] };
    const dprId = randomUUID(); const projectId = randomUUID();
    await transitionDpr(ctx as never, projectId, dprId, { action: "return", reason: "Revise cost" });
    const msg = publish.mock.calls[0]![1] as { type: string; payload: Record<string, unknown> };
    expect(msg.type).toBe(COMMANDS.dprTransition);
    expect(msg.payload.action).toBe("return");
    expect(msg.payload.reason).toBe("Revise cost");
    expect(msg.payload.dprId).toBe(dprId);
  });
});

describe("DPR transition consumer (status machine + audit in same tx)", () => {
  it("review: submitted → under_review, emits the transition event and audit", async () => {
    const dprId = randomUUID(); const projectId = randomUUID();
    repoMock.findDprByIdTx.mockResolvedValue({ id: dprId, projectId, status: "submitted", version: 1 });
    const q = new MemoryQueue(); registerProgressConsumers(q); await q.start();
    await publishTransition(q, dprId, projectId, "review");
    await settle();
    expect(repoMock.transitionDprTx).toHaveBeenCalledWith(
      mockTx, dprId, TENANT, "submitted", "under_review", ACTOR, null, 1,
    );
    const event = enqueuedMessages.find((m) => m.topic === EVENTS.dprTransitioned);
    expect(event?.payload).toMatchObject({ from: "submitted", to: "under_review" });
    const audit = enqueuedMessages.find((m) => m.topic === "audit.event.record");
    expect(audit?.payload.action).toBe("dpr_review");
    expect(audit?.payload.resourceType).toBe("dpr");
    await q.stop();
  });

  it("return: under_review → revision records the reason on the audit event", async () => {
    const dprId = randomUUID(); const projectId = randomUUID();
    repoMock.findDprByIdTx.mockResolvedValue({ id: dprId, projectId, status: "under_review", version: 2 });
    const q = new MemoryQueue(); registerProgressConsumers(q); await q.start();
    await publishTransition(q, dprId, projectId, "return", "Revise cost estimate");
    await settle();
    expect(repoMock.transitionDprTx).toHaveBeenCalledWith(
      mockTx, dprId, TENANT, "under_review", "revision", ACTOR, "Revise cost estimate", 2,
    );
    const audit = enqueuedMessages.find((m) => m.topic === "audit.event.record");
    expect(audit?.payload.action).toBe("dpr_return");
    expect(audit?.payload.reason).toBe("Revise cost estimate");
    await q.stop();
  });

  it("is a no-op (no transition, no audit) when the DPR is not in the required source status", async () => {
    const dprId = randomUUID(); const projectId = randomUUID();
    // approve requires under_review; a submitted DPR must not jump to approved.
    repoMock.findDprByIdTx.mockResolvedValue({ id: dprId, projectId, status: "submitted", version: 1 });
    const q = new MemoryQueue(); registerProgressConsumers(q); await q.start();
    await publishTransition(q, dprId, projectId, "approve");
    await settle();
    expect(repoMock.transitionDprTx).not.toHaveBeenCalled();
    expect(enqueuedMessages.find((m) => m.topic === "audit.event.record")).toBeUndefined();
    await q.stop();
  });

  it("is idempotent on duplicate delivery (markProcessed false → no work)", async () => {
    markProcessedMock.mockResolvedValue(false);
    const dprId = randomUUID(); const projectId = randomUUID();
    repoMock.findDprByIdTx.mockResolvedValue({ id: dprId, projectId, status: "submitted", version: 1 });
    const q = new MemoryQueue(); registerProgressConsumers(q); await q.start();
    await publishTransition(q, dprId, projectId, "review");
    await settle();
    expect(repoMock.transitionDprTx).not.toHaveBeenCalled();
    expect(enqueuedMessages).toHaveLength(0);
    await q.stop();
  });

  it("writes no audit when the optimistic-lock race is lost (transition updates 0 rows)", async () => {
    const dprId = randomUUID(); const projectId = randomUUID();
    repoMock.findDprByIdTx.mockResolvedValue({ id: dprId, projectId, status: "under_review", version: 2 });
    repoMock.transitionDprTx.mockResolvedValue(0);
    const q = new MemoryQueue(); registerProgressConsumers(q); await q.start();
    await publishTransition(q, dprId, projectId, "approve");
    await settle();
    expect(enqueuedMessages.find((m) => m.topic === "audit.event.record")).toBeUndefined();
    await q.stop();
  });
});
