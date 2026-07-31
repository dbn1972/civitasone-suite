/**
 * Board-decision HR intake consumer — comprehensive unit tests.
 *
 * Covers:
 *   - Message routing (correct handler called for meeting.decision.hr topic)
 *   - Idempotency (markProcessed returns false → skip)
 *   - Happy path processing (intake creation + audit event)
 *   - Error handling (invalid payload, missing entities)
 *   - Cache invalidation after writes
 *   - Re-published decision idempotency (ON CONFLICT no-op)
 *   - Tenant scoping via runWithTenant
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const H = vi.hoisted(() => ({
  markProcessed: vi.fn(),
  enqueue: vi.fn(),
  insertIntakeIdempotent: vi.fn(),
  cacheInvalidate: vi.fn(),
  cacheMakeKey: vi.fn((...parts: string[]) => parts.join(":")),
  runWithTenant: vi.fn(),
  dbTransaction: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: (...a: unknown[]) => H.dbTransaction(...a) },
  sqlClient: { end: async () => {} },
}));
vi.mock("@civitasone/db", () => ({
  runWithTenant: (...a: unknown[]) => H.runWithTenant(...a),
}));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: (...a: unknown[]) => H.enqueue(...a),
  markProcessed: (...a: unknown[]) => H.markProcessed(...a),
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: {
    invalidate: (...a: unknown[]) => H.cacheInvalidate(...a),
    makeKey: (...a: unknown[]) => H.cacheMakeKey(...a),
  },
  queue: { publish: async () => {} },
}));
vi.mock("../src/modules/board-intake/repo.js", () => ({
  insertIntakeIdempotent: (...a: unknown[]) => H.insertIntakeIdempotent(...a),
}));

import { registerBoardIntakeConsumers } from "../src/modules/board-intake/consumer.js";
import { CONSUMED_EVENTS } from "../src/topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
const CORR = "30000000-cccc-4000-8000-000000000001";

function makeMsg(payload: Record<string, unknown>, overrides?: Partial<{ messageId: string; tenantId: string; actorId: string }>) {
  return {
    messageId: overrides?.messageId ?? randomUUID(),
    type: CONSUMED_EVENTS.boardDecisionHr,
    tenantId: overrides?.tenantId ?? TENANT,
    actorId: overrides?.actorId ?? ACTOR,
    correlationId: CORR,
    schemaVersion: "1.0",
    payload,
  };
}

const settle = () => new Promise<void>((r) => setTimeout(r, 80));
const mockTx = {};

beforeEach(() => {
  vi.clearAllMocks();
  H.markProcessed.mockResolvedValue(true);
  H.insertIntakeIdempotent.mockResolvedValue(true);
  H.enqueue.mockResolvedValue(undefined);
  H.cacheInvalidate.mockResolvedValue(undefined);
  H.dbTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => cb(mockTx));
  H.runWithTenant.mockImplementation(async (_t: string, fn: () => Promise<unknown>) => fn());
});

// ─── Message routing ────────────────────────────────────────────────────────

describe("message routing", () => {
  it("subscribes to the meeting.decision.hr topic", async () => {
    const q = new MemoryQueue();
    registerBoardIntakeConsumers(q);
    await q.start();

    const decisionId = randomUUID();
    await q.publish(CONSUMED_EVENTS.boardDecisionHr, makeMsg({
      decisionId, meetingId: randomUUID(), text: "Promote officers",
    }));
    await settle();

    expect(H.markProcessed).toHaveBeenCalledOnce();
    await q.stop();
  });

  it("does NOT react to unrelated topics", async () => {
    const q = new MemoryQueue();
    registerBoardIntakeConsumers(q);
    await q.start();

    await q.publish("some.other.topic", makeMsg({
      decisionId: randomUUID(), meetingId: randomUUID(), text: "Something else",
    }));
    await settle();

    expect(H.markProcessed).not.toHaveBeenCalled();
    await q.stop();
  });
});

// ─── Idempotency ────────────────────────────────────────────────────────────

describe("idempotency", () => {
  it("skips processing when markProcessed returns false (duplicate messageId)", async () => {
    H.markProcessed.mockResolvedValue(false);
    const q = new MemoryQueue();
    registerBoardIntakeConsumers(q);
    await q.start();

    await q.publish(CONSUMED_EVENTS.boardDecisionHr, makeMsg({
      decisionId: randomUUID(), meetingId: randomUUID(), text: "Duplicate delivery",
    }));
    await settle();

    expect(H.markProcessed).toHaveBeenCalledOnce();
    expect(H.insertIntakeIdempotent).not.toHaveBeenCalled();
    expect(H.enqueue).not.toHaveBeenCalled();
    await q.stop();
  });

  it("skips audit when insertIntakeIdempotent returns false (re-published decision)", async () => {
    H.insertIntakeIdempotent.mockResolvedValue(false);
    const q = new MemoryQueue();
    registerBoardIntakeConsumers(q);
    await q.start();

    await q.publish(CONSUMED_EVENTS.boardDecisionHr, makeMsg({
      decisionId: randomUUID(), meetingId: randomUUID(), text: "Re-published decision",
    }));
    await settle();

    expect(H.markProcessed).toHaveBeenCalledOnce();
    expect(H.insertIntakeIdempotent).toHaveBeenCalledOnce();
    // No audit emitted for replay (decision already existed)
    expect(H.enqueue).not.toHaveBeenCalled();
    await q.stop();
  });
});

// ─── Happy path processing ──────────────────────────────────────────────────

describe("happy path processing", () => {
  it("creates a pending_review intake item with correct fields", async () => {
    const q = new MemoryQueue();
    registerBoardIntakeConsumers(q);
    await q.start();

    const decisionId = randomUUID();
    const meetingId = randomUUID();
    const committeeId = randomUUID();
    await q.publish(CONSUMED_EVENTS.boardDecisionHr, makeMsg({
      decisionId, meetingId, text: "Regularise contractual staff",
      authority: "Board of Governors", effectiveDate: "2025-04-01", committeeId,
    }));
    await settle();

    expect(H.insertIntakeIdempotent).toHaveBeenCalledOnce();
    const [tx, row] = H.insertIntakeIdempotent.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(tx).toBe(mockTx);
    expect(row.tenantId).toBe(TENANT);
    expect(row.source).toBe("meeting");
    expect(row.decisionId).toBe(decisionId);
    expect(row.meetingId).toBe(meetingId);
    expect(row.committeeId).toBe(committeeId);
    expect(row.text).toBe("Regularise contractual staff");
    expect(row.authority).toBe("Board of Governors");
    expect(row.effectiveDate).toBe("2025-04-01");
    expect(row.status).toBe("pending_review");
    expect(row.id).toBeDefined();
    await q.stop();
  });

  it("emits an audit event with correct metadata on successful creation", async () => {
    const q = new MemoryQueue();
    registerBoardIntakeConsumers(q);
    await q.start();

    const decisionId = randomUUID();
    const meetingId = randomUUID();
    await q.publish(CONSUMED_EVENTS.boardDecisionHr, makeMsg({
      decisionId, meetingId, text: "Transfer order", authority: "Commissioner",
    }));
    await settle();

    expect(H.enqueue).toHaveBeenCalledOnce();
    const [tx, auditMsg] = H.enqueue.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(tx).toBe(mockTx);
    expect(auditMsg.topic).toBe("audit.event.record");
    expect(auditMsg.tenantId).toBe(TENANT);
    expect(auditMsg.actorId).toBe(ACTOR);

    const payload = auditMsg.payload as Record<string, unknown>;
    expect(payload.service).toBe("hrms");
    expect(payload.action).toBe("intake_open");
    expect(payload.resourceType).toBe("board_decision_intake");
    expect(payload.resourceId).toBe(decisionId);
    expect(payload.outcome).toBe("success");
    expect((payload.metadata as Record<string, unknown>).meetingId).toBe(meetingId);
    expect((payload.metadata as Record<string, unknown>).authority).toBe("Commissioner");
    await q.stop();
  });

  it("does NOT include authority in audit metadata when not provided", async () => {
    const q = new MemoryQueue();
    registerBoardIntakeConsumers(q);
    await q.start();

    await q.publish(CONSUMED_EVENTS.boardDecisionHr, makeMsg({
      decisionId: randomUUID(), meetingId: randomUUID(), text: "Simple decision",
    }));
    await settle();

    const [, auditMsg] = H.enqueue.mock.calls[0] as [unknown, Record<string, unknown>];
    const payload = auditMsg.payload as Record<string, unknown>;
    const metadata = payload.metadata as Record<string, unknown>;
    expect(metadata.authority).toBeUndefined();
    await q.stop();
  });

  it("handles optional fields (committeeId, authority, effectiveDate) as null", async () => {
    const q = new MemoryQueue();
    registerBoardIntakeConsumers(q);
    await q.start();

    const decisionId = randomUUID();
    await q.publish(CONSUMED_EVENTS.boardDecisionHr, makeMsg({
      decisionId, meetingId: randomUUID(), text: "Minimal payload decision",
    }));
    await settle();

    const [, row] = H.insertIntakeIdempotent.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(row.committeeId).toBeNull();
    expect(row.authority).toBeNull();
    expect(row.effectiveDate).toBeNull();
    await q.stop();
  });

  it("passes the correct correlationId from message to audit", async () => {
    const q = new MemoryQueue();
    registerBoardIntakeConsumers(q);
    await q.start();

    await q.publish(CONSUMED_EVENTS.boardDecisionHr, makeMsg({
      decisionId: randomUUID(), meetingId: randomUUID(), text: "Corr test",
    }));
    await settle();

    const [, auditMsg] = H.enqueue.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(auditMsg.correlationId).toBe(CORR);
    await q.stop();
  });
});

// ─── Error handling (invalid payload, missing entities) ─────────────────────

describe("error handling — invalid payloads", () => {
  it("drops payload missing decisionId", async () => {
    const q = new MemoryQueue();
    registerBoardIntakeConsumers(q);
    await q.start();

    await q.publish(CONSUMED_EVENTS.boardDecisionHr, makeMsg({
      meetingId: randomUUID(), text: "No decision id",
    }));
    await settle();

    expect(H.markProcessed).not.toHaveBeenCalled();
    expect(H.insertIntakeIdempotent).not.toHaveBeenCalled();
    await q.stop();
  });

  it("drops payload missing meetingId", async () => {
    const q = new MemoryQueue();
    registerBoardIntakeConsumers(q);
    await q.start();

    await q.publish(CONSUMED_EVENTS.boardDecisionHr, makeMsg({
      decisionId: randomUUID(), text: "No meeting id",
    }));
    await settle();

    expect(H.markProcessed).not.toHaveBeenCalled();
    expect(H.insertIntakeIdempotent).not.toHaveBeenCalled();
    await q.stop();
  });

  it("drops payload missing text", async () => {
    const q = new MemoryQueue();
    registerBoardIntakeConsumers(q);
    await q.start();

    await q.publish(CONSUMED_EVENTS.boardDecisionHr, makeMsg({
      decisionId: randomUUID(), meetingId: randomUUID(),
    }));
    await settle();

    expect(H.markProcessed).not.toHaveBeenCalled();
    expect(H.insertIntakeIdempotent).not.toHaveBeenCalled();
    await q.stop();
  });

  it("drops payload with empty string decisionId", async () => {
    const q = new MemoryQueue();
    registerBoardIntakeConsumers(q);
    await q.start();

    await q.publish(CONSUMED_EVENTS.boardDecisionHr, makeMsg({
      decisionId: "", meetingId: randomUUID(), text: "Empty decision",
    }));
    await settle();

    expect(H.markProcessed).not.toHaveBeenCalled();
    expect(H.insertIntakeIdempotent).not.toHaveBeenCalled();
    await q.stop();
  });

  it("drops null payload entirely", async () => {
    const q = new MemoryQueue();
    registerBoardIntakeConsumers(q);
    await q.start();

    await q.publish(CONSUMED_EVENTS.boardDecisionHr, {
      messageId: randomUUID(),
      type: CONSUMED_EVENTS.boardDecisionHr,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: CORR,
      schemaVersion: "1.0",
      payload: null,
    });
    await settle();

    expect(H.markProcessed).not.toHaveBeenCalled();
    expect(H.insertIntakeIdempotent).not.toHaveBeenCalled();
    await q.stop();
  });

  it("drops undefined payload", async () => {
    const q = new MemoryQueue();
    registerBoardIntakeConsumers(q);
    await q.start();

    await q.publish(CONSUMED_EVENTS.boardDecisionHr, {
      messageId: randomUUID(),
      type: CONSUMED_EVENTS.boardDecisionHr,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: CORR,
      schemaVersion: "1.0",
      payload: undefined,
    });
    await settle();

    expect(H.markProcessed).not.toHaveBeenCalled();
    expect(H.insertIntakeIdempotent).not.toHaveBeenCalled();
    await q.stop();
  });
});

// ─── Cache invalidation after writes ────────────────────────────────────────

describe("cache invalidation", () => {
  it("invalidates pending board_decision_intake cache key after successful creation", async () => {
    const q = new MemoryQueue();
    registerBoardIntakeConsumers(q);
    await q.start();

    await q.publish(CONSUMED_EVENTS.boardDecisionHr, makeMsg({
      decisionId: randomUUID(), meetingId: randomUUID(), text: "Cache test",
    }));
    await settle();

    expect(H.cacheMakeKey).toHaveBeenCalledWith(TENANT, "board_decision_intake", "pending");
    expect(H.cacheInvalidate).toHaveBeenCalledOnce();
    const cacheKey = H.cacheMakeKey(TENANT, "board_decision_intake", "pending");
    expect(H.cacheInvalidate).toHaveBeenCalledWith(cacheKey);
    await q.stop();
  });

  it("invalidates cache even when intake already existed (re-published decision)", async () => {
    H.insertIntakeIdempotent.mockResolvedValue(false);
    const q = new MemoryQueue();
    registerBoardIntakeConsumers(q);
    await q.start();

    await q.publish(CONSUMED_EVENTS.boardDecisionHr, makeMsg({
      decisionId: randomUUID(), meetingId: randomUUID(), text: "Re-published",
    }));
    await settle();

    // Cache invalidation happens outside the transaction, always after consumer completes
    expect(H.cacheInvalidate).toHaveBeenCalledOnce();
    await q.stop();
  });

  it("invalidates cache with correct tenant-scoped key", async () => {
    const customTenant = "99999999-aaaa-4000-8000-000000000099";
    const q = new MemoryQueue();
    registerBoardIntakeConsumers(q);
    await q.start();

    await q.publish(CONSUMED_EVENTS.boardDecisionHr, makeMsg(
      { decisionId: randomUUID(), meetingId: randomUUID(), text: "Tenant test" },
      { tenantId: customTenant },
    ));
    await settle();

    expect(H.cacheMakeKey).toHaveBeenCalledWith(customTenant, "board_decision_intake", "pending");
    await q.stop();
  });
});

// ─── Tenant scoping ─────────────────────────────────────────────────────────

describe("tenant scoping", () => {
  it("calls runWithTenant with the message tenantId", async () => {
    const q = new MemoryQueue();
    registerBoardIntakeConsumers(q);
    await q.start();

    const customTenant = "55555555-aaaa-4000-8000-000000000099";
    await q.publish(CONSUMED_EVENTS.boardDecisionHr, makeMsg(
      { decisionId: randomUUID(), meetingId: randomUUID(), text: "Tenant scope test" },
      { tenantId: customTenant },
    ));
    await settle();

    expect(H.runWithTenant).toHaveBeenCalledWith(customTenant, expect.any(Function));
    await q.stop();
  });

  it("processes messages from different tenants independently", async () => {
    const q = new MemoryQueue();
    registerBoardIntakeConsumers(q);
    await q.start();

    const tenant1 = "11111111-aaaa-4000-8000-000000000001";
    const tenant2 = "22222222-aaaa-4000-8000-000000000002";

    await q.publish(CONSUMED_EVENTS.boardDecisionHr, makeMsg(
      { decisionId: randomUUID(), meetingId: randomUUID(), text: "Tenant 1" },
      { tenantId: tenant1 },
    ));
    await q.publish(CONSUMED_EVENTS.boardDecisionHr, makeMsg(
      { decisionId: randomUUID(), meetingId: randomUUID(), text: "Tenant 2" },
      { tenantId: tenant2 },
    ));
    await settle();

    expect(H.runWithTenant).toHaveBeenCalledWith(tenant1, expect.any(Function));
    expect(H.runWithTenant).toHaveBeenCalledWith(tenant2, expect.any(Function));
    expect(H.insertIntakeIdempotent).toHaveBeenCalledTimes(2);
    await q.stop();
  });
});
