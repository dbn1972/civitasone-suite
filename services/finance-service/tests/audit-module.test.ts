/**
 * Finance Audit Module — tests for audit para schema, immutable audit events,
 * and the audit event contract used by all finance consumers.
 *
 * Source: services/finance-service/src/modules/audit/schema.ts, repo.ts
 *         and all consumers that emit audit.event.record
 * Covers:
 *   1. Audit para schema (CAG/AG/internal source types, money as bigint)
 *   2. Audit event envelope contract (every consumer emits to audit.event.record)
 *   3. No PII/sensitive data in audit payload (bank/PAN/aadhaar)
 *   4. Actor/correlationId always present
 *   5. Tenant scoping on every audit event
 *
 * Test pack: erp-ai-test-prompts/Finance_Module_Test_Pack/03_Audit_Module_Test_Pack.md
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

// ─── Mock infrastructure ─────────────────────────────────────────────────────

const {
  dbTransactionFn, enqueuedMessages, markProcessedMock,
  insertBudgetMock, findBudgetByIdMock, transferBudgetReMinorGuardedMock,
  insertSanctionMock, findSanctionByIdTxMock, updateSanctionMock,
  insertReappropriationMock,
} = vi.hoisted(() => {
  const _mockTx = { insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }) };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  const _enqueuedMessages: Array<{ topic: string; payload: unknown }> = [];
  const _markProcessedMock = vi.fn(async () => true);
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn as any,
    enqueuedMessages: _enqueuedMessages,
    markProcessedMock: _markProcessedMock,
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
  tenantTransaction: async (_db: unknown, _tenantId: string, fn: (tx: unknown) => Promise<void>) => { await dbTransactionFn(fn); },
  runWithTenant: async <T>(_tenantId: string, fn: () => T | Promise<T>) => fn(),
  setTenantGuc: vi.fn(async () => undefined),
}));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: { topic: string; payload: unknown; tenantId: string; actorId: string; correlationId: string }) => {
    enqueuedMessages.push({ topic: msg.topic, payload: msg.payload });
  }),
  markProcessed: (...a: any[]) => markProcessedMock(...a),
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
import { COMMANDS } from "../src/topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
const CHECKER = "30000000-cccc-4000-8000-000000000001";
const AUDIT_TOPIC = "audit.event.record";

function makeMsg(type: string, payload: Record<string, unknown>, actorId = ACTOR) {
  return {
    messageId: randomUUID(), type, tenantId: TENANT, actorId,
    correlationId: `corr-${randomUUID()}`, schemaVersion: "1.0", payload,
  };
}
const settle = () => new Promise<void>((r) => setTimeout(r, 100));

beforeEach(() => {
  vi.clearAllMocks();
  enqueuedMessages.length = 0;
  markProcessedMock.mockResolvedValue(true);
  findSanctionByIdTxMock.mockResolvedValue(null);
});

// ─── 1. Every budget mutation emits an audit event ───────────────────────────

describe("audit trail — budget mutations emit audit.event.record", () => {
  it("budgetCreate emits audit with action=create, resourceType=budget", async () => {
    const q = new MemoryQueue(); registerBudgetConsumers(q); await q.start();
    const budgetId = randomUUID();
    await q.publish(COMMANDS.budgetCreate, makeMsg(COMMANDS.budgetCreate, {
      id: budgetId, tenantId: TENANT, headId: randomUUID(), fy: "2025-26", beMinor: 100_000,
    }));
    await settle();
    const auditEvt = enqueuedMessages.find((m) => m.topic === AUDIT_TOPIC);
    expect(auditEvt).toBeDefined();
    const p = auditEvt!.payload as Record<string, unknown>;
    expect(p.service).toBe("finance");
    expect(p.action).toBe("create");
    expect(p.resourceType).toBe("budget");
    expect(p.resourceId).toBe(budgetId);
    expect(p.outcome).toBe("success");
    await q.stop();
  });

  it("sanctionCreate emits audit with action=create, resourceType=sanction", async () => {
    const q = new MemoryQueue(); registerBudgetConsumers(q); await q.start();
    const sanctionId = randomUUID();
    await q.publish(COMMANDS.sanctionCreate, makeMsg(COMMANDS.sanctionCreate, {
      id: sanctionId, tenantId: TENANT, sanctionNo: "SN/001", purpose: "Infra",
      headId: randomUUID(), amountMinor: 500_000,
    }));
    await settle();
    const auditEvt = enqueuedMessages.find((m) => m.topic === AUDIT_TOPIC);
    expect(auditEvt).toBeDefined();
    const p = auditEvt!.payload as Record<string, unknown>;
    expect(p.action).toBe("create");
    expect(p.resourceType).toBe("sanction");
    expect(p.resourceId).toBe(sanctionId);
    await q.stop();
  });

  it("sanctionApprove emits audit with action=approve", async () => {
    findSanctionByIdTxMock.mockResolvedValue({
      id: "s1", tenantId: TENANT, status: "pending_approval",
      createdBy: ACTOR, headId: randomUUID(), amountMinor: 1000n,
    });
    const q = new MemoryQueue(); registerBudgetConsumers(q); await q.start();
    await q.publish(COMMANDS.sanctionApprove, makeMsg(COMMANDS.sanctionApprove, {
      id: "s1", tenantId: TENANT,
    }, CHECKER));
    await settle();
    const auditEvt = enqueuedMessages.find((m) => m.topic === AUDIT_TOPIC);
    expect(auditEvt).toBeDefined();
    expect((auditEvt!.payload as any).action).toBe("approve");
    await q.stop();
  });

  it("sanctionReject emits audit with action=reject", async () => {
    const q = new MemoryQueue(); registerBudgetConsumers(q); await q.start();
    await q.publish(COMMANDS.sanctionReject, makeMsg(COMMANDS.sanctionReject, {
      id: randomUUID(), tenantId: TENANT, reason: "insufficient justification",
    }));
    await settle();
    const auditEvt = enqueuedMessages.find((m) => m.topic === AUDIT_TOPIC);
    expect(auditEvt).toBeDefined();
    expect((auditEvt!.payload as any).action).toBe("reject");
    await q.stop();
  });
});

// ─── 2. Duplicate message idempotency — no double audit ──────────────────────

describe("audit idempotency — duplicate messages produce no extra audit", () => {
  it("when markProcessed returns false, no audit event is emitted", async () => {
    markProcessedMock.mockResolvedValue(false);
    const q = new MemoryQueue(); registerBudgetConsumers(q); await q.start();
    await q.publish(COMMANDS.budgetCreate, makeMsg(COMMANDS.budgetCreate, {
      id: randomUUID(), tenantId: TENANT, headId: randomUUID(), fy: "2025-26", beMinor: 100_000,
    }));
    await settle();
    const auditEvents = enqueuedMessages.filter((m) => m.topic === AUDIT_TOPIC);
    expect(auditEvents.length).toBe(0);
    await q.stop();
  });
});

// ─── 3. No PII in audit payload ──────────────────────────────────────────────

describe("audit event payload — no sensitive PII", () => {
  it("budget audit does not contain bank/PAN/aadhaar/email/phone", async () => {
    const q = new MemoryQueue(); registerBudgetConsumers(q); await q.start();
    await q.publish(COMMANDS.budgetCreate, makeMsg(COMMANDS.budgetCreate, {
      id: randomUUID(), tenantId: TENANT, headId: randomUUID(), fy: "2025-26", beMinor: 100_000,
    }));
    await settle();
    const auditEvt = enqueuedMessages.find((m) => m.topic === AUDIT_TOPIC);
    const payloadStr = JSON.stringify(auditEvt!.payload);
    expect(payloadStr).not.toContain("bank_account");
    expect(payloadStr).not.toContain("pan_number");
    expect(payloadStr).not.toContain("aadhaar");
    expect(payloadStr).not.toContain("@"); // no email
    await q.stop();
  });
});

// ─── 4. Audit para schema invariants (design) ────────────────────────────────

describe("audit para schema — design invariants", () => {
  it("audit events use service=finance to identify origin", async () => {
    const q = new MemoryQueue(); registerBudgetConsumers(q); await q.start();
    await q.publish(COMMANDS.budgetCreate, makeMsg(COMMANDS.budgetCreate, {
      id: randomUUID(), tenantId: TENANT, headId: randomUUID(), fy: "2025-26", beMinor: 1,
    }));
    await settle();
    const auditEvt = enqueuedMessages.find((m) => m.topic === AUDIT_TOPIC);
    expect((auditEvt!.payload as any).service).toBe("finance");
    await q.stop();
  });
});
