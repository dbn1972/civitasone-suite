/**
 * Budget consumer mock tests — covers all budget/sanction commands.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const {
  mockTx, dbTransactionFn, enqueuedMessages,
  insertBudgetMock, findBudgetByIdMock, transferBudgetReMinorGuardedMock,
  insertSanctionMock, findSanctionByIdTxMock, updateSanctionMock,
  insertReappropriationMock,
} = vi.hoisted(() => {
  const _mockTx = { insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }) };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  const _enqueuedMessages: Array<{ topic: string; payload: unknown }> = [];
  return {
    mockTx: _mockTx, dbTransactionFn: _dbTransactionFn as any,
    enqueuedMessages: _enqueuedMessages,
    insertBudgetMock: vi.fn(async () => undefined),
    findBudgetByIdMock: vi.fn(async () => null as any),
    transferBudgetReMinorGuardedMock: vi.fn(async () => true),
    insertSanctionMock: vi.fn(async () => undefined),
    findSanctionByIdTxMock: vi.fn(async () => null as any),
    updateSanctionMock: vi.fn(async () => undefined),
    insertReappropriationMock: vi.fn(async () => undefined),
  };
});

vi.mock("../src/shared/db.js", () => ({ db: { transaction: dbTransactionFn } }));
vi.mock("@civitasone/db", () => ({
  tenantTransaction: async (_db: unknown, _tenantId: string, fn: (tx: unknown) => Promise<void>) => {
    await dbTransactionFn(fn);
  },
  // Consumers wrap each handler in runWithTenant(msg.tenantId, ...) so db.transaction
  // sets the app.tenant_id GUC; in this unit test it just runs the handler.
  runWithTenant: async <T>(_tenantId: string, fn: () => T | Promise<T>) => fn(),
  setTenantGuc: vi.fn(async () => undefined),
  // FIX: tenant-queue.ts's tenantScoped() wraps every subscribed consumer
  // handler in withTenantConsumer() (imported from @civitasone/db). This mock
  // replaces the whole module, so without this export registerBudgetConsumers
  // throws "No withTenantConsumer export is defined on the mock" before any
  // handler runs. runWithTenant above is already an identity passthrough for
  // this test, so withTenantConsumer only needs to be too (matches the
  // convention already used in tests/consumer-coverage-ext.test.ts).
  withTenantConsumer: vi.fn((handler: any) => handler),
}));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: { topic: string; payload: unknown }) => { enqueuedMessages.push({ topic: msg.topic, payload: msg.payload }); }),
  markProcessed: vi.fn(async () => true),
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: { invalidate: vi.fn(async () => undefined), makeKey: (...parts: string[]) => parts.join(":") },
}));
vi.mock("../src/modules/budget/repo.js", () => ({
  insertBudget: (...a: any[]) => insertBudgetMock(...a),
  findBudgetById: (...a: any[]) => findBudgetByIdMock(...a),
  findBudgetByIdTx: (...a: any[]) => findBudgetByIdMock(...a),
  transferBudgetReMinorGuarded: (...a: any[]) => transferBudgetReMinorGuardedMock(...a),
  insertSanction: (...a: any[]) => insertSanctionMock(...a),
  findSanctionByIdTx: (...a: any[]) => findSanctionByIdTxMock(...a),
  updateSanction: (...a: any[]) => updateSanctionMock(...a),
  insertReappropriation: (...a: any[]) => insertReappropriationMock(...a),
}));

import { registerBudgetConsumers } from "../src/modules/budget/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
const CHECKER = "30000000-cccc-4000-8000-000000000001";

function makeMsg(type: string, payload: Record<string, unknown>, actorId = ACTOR) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}
const settle = () => new Promise<void>((r) => setTimeout(r, 100));

beforeEach(() => {
  vi.clearAllMocks();
  enqueuedMessages.length = 0;
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
  findBudgetByIdMock.mockResolvedValue(null);
  findSanctionByIdTxMock.mockResolvedValue(null);
});

describe("budgetCreate command", () => {
  it("inserts budget with BE=RE", async () => {
    const q = new MemoryQueue(); registerBudgetConsumers(q); await q.start();
    await q.publish(COMMANDS.budgetCreate, makeMsg(COMMANDS.budgetCreate, {
      id: randomUUID(), tenantId: TENANT, headId: randomUUID(), fy: "2025-26", beMinor: 10000000,
    }));
    await settle();
    expect(insertBudgetMock).toHaveBeenCalledOnce();
    const row = insertBudgetMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(row.beMinor).toBe(10000000n);
    expect(row.reMinor).toBe(10000000n);
    await q.stop();
  });
});

describe("budgetReappropriate command", () => {
  it("transfers RE from source to target", async () => {
    findBudgetByIdMock.mockResolvedValue({ id: "src", tenantId: TENANT, reMinor: 5000000n, utilisedMinor: 1000000n });
    const q = new MemoryQueue(); registerBudgetConsumers(q); await q.start();
    await q.publish(COMMANDS.budgetReappropriate, makeMsg(COMMANDS.budgetReappropriate, {
      id: randomUUID(), tenantId: TENANT, fromBudgetId: "src", amountMinor: 2000000, reason: "urgent need",
    }));
    await settle();
    expect(transferBudgetReMinorGuardedMock).toHaveBeenCalledOnce();
    await q.stop();
  });
});

describe("sanctionCreate command", () => {
  it("inserts sanction with pending_approval status", async () => {
    const q = new MemoryQueue(); registerBudgetConsumers(q); await q.start();
    const id = randomUUID();
    await q.publish(COMMANDS.sanctionCreate, makeMsg(COMMANDS.sanctionCreate, {
      id, tenantId: TENANT, sanctionNo: "SN/2026/001", purpose: "Infrastructure",
      headId: randomUUID(), amountMinor: 50000000,
    }));
    await settle();
    expect(insertSanctionMock).toHaveBeenCalledOnce();
    const row = insertSanctionMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(row.status).toBe("pending_approval");
    await q.stop();
  });
});

describe("sanctionApprove command", () => {
  it("approves a pending sanction by a different officer", async () => {
    const sanctionId = randomUUID();
    findSanctionByIdTxMock.mockResolvedValue({
      id: sanctionId, tenantId: TENANT, status: "pending_approval",
      createdBy: ACTOR, headId: randomUUID(), amountMinor: 50000000n,
    });
    const q = new MemoryQueue(); registerBudgetConsumers(q); await q.start();
    await q.publish(COMMANDS.sanctionApprove, makeMsg(COMMANDS.sanctionApprove, {
      id: sanctionId, tenantId: TENANT,
    }, CHECKER));
    await settle();
    expect(updateSanctionMock).toHaveBeenCalledOnce();
    const [, , patch] = updateSanctionMock.mock.calls[0]! as [unknown, string, Record<string, unknown>];
    expect(patch.status).toBe("approved");
    const evt = enqueuedMessages.find((m) => m.topic === EVENTS.sanctionApproved);
    expect(evt).toBeDefined();
    await q.stop();
  });

  it("blocks self-approval (maker-checker)", async () => {
    findSanctionByIdTxMock.mockResolvedValue({
      id: "s1", tenantId: TENANT, status: "pending_approval",
      createdBy: ACTOR, headId: randomUUID(), amountMinor: 1000n,
    });
    const q = new MemoryQueue(); registerBudgetConsumers(q); await q.start();
    // Same actor tries to approve their own sanction
    await q.publish(COMMANDS.sanctionApprove, makeMsg(COMMANDS.sanctionApprove, {
      id: "s1", tenantId: TENANT,
    }, ACTOR)); // same as createdBy
    await settle();
    // Should have thrown — updateSanction NOT called
    expect(updateSanctionMock).not.toHaveBeenCalled();
    await q.stop();
  });
});

describe("sanctionReject command", () => {
  it("cancels the sanction", async () => {
    const id = randomUUID();
    // FIX: missing mock setup -- findSanctionByIdTxMock defaults to null (see
    // beforeEach above), so the consumer's `if (!sanction ...) throw
    // NonRetryableError(...)` fired before ever reaching updateSanction,
    // silently landing in the queue's internal DLQ (MemoryQueue.publish() is
    // fire-and-forget and never surfaces a handler's thrown error to the
    // caller). createdBy must differ from the rejecting actor (default ACTOR
    // from makeMsg) -- sanctionReject enforces the same maker-checker rule as
    // sanctionApprove (assertSanctionApproverDistinct) -- so use CHECKER,
    // matching the "different officer" pattern in sanctionApprove above.
    findSanctionByIdTxMock.mockResolvedValue({
      id, tenantId: TENANT, status: "pending_approval",
      createdBy: CHECKER, headId: randomUUID(), amountMinor: 50000000n,
    });
    const q = new MemoryQueue(); registerBudgetConsumers(q); await q.start();
    await q.publish(COMMANDS.sanctionReject, makeMsg(COMMANDS.sanctionReject, {
      id, tenantId: TENANT, reason: "insufficient justification",
    }));
    await settle();
    expect(updateSanctionMock).toHaveBeenCalledOnce();
    const [, , patch] = updateSanctionMock.mock.calls[0]! as [unknown, string, Record<string, unknown>];
    expect(patch.status).toBe("cancelled");
    await q.stop();
  });
});

describe("reappropriationSubmitApproval command", () => {
  it("inserts reappropriation with pending_approval", async () => {
    const q = new MemoryQueue(); registerBudgetConsumers(q); await q.start();
    await q.publish(COMMANDS.reappropriationSubmitApproval, makeMsg(COMMANDS.reappropriationSubmitApproval, {
      id: randomUUID(), tenantId: TENANT, fromBudgetId: randomUUID(),
      toBudgetId: randomUUID(), amountMinor: 3000000, reason: "quarterly adjustment",
    }));
    await settle();
    expect(insertReappropriationMock).toHaveBeenCalledOnce();
    const row = insertReappropriationMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(row.status).toBe("pending_approval");
    await q.stop();
  });
});
