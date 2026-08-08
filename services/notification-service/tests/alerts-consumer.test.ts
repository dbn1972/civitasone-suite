/**
 * Notification Alerts — Consumer Integration Test
 *
 * Module: services/notification-service/src/modules/alerts
 * Pack: Notification_Module_Test_Pack/01_Alerts_Test_Prompt.md
 *
 * Tests the actual consumer handlers via MemoryQueue:
 *   1. createAlertRule: inserts rule, emits alertRuleCreated + audit, invalidates cache
 *   2. enableAlertRule / disableAlertRule: toggles enabled, emits audit
 *   3. Idempotency: duplicate messageId is skipped (markProcessed returns false)
 *   4. Tenant scoping: tenantId flows through all operations
 *   5. Audit trail: every mutation emits audit.event.record
 *   6. Cache invalidation after every write
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const {
  dbTransactionFn,
  enqueuedMessages,
  markProcessedMock,
  insertRuleMock,
  setRuleEnabledMock,
  cacheInvalidateMock,
} = vi.hoisted(() => {
  const _mockTx = {};
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  const _enqueuedMessages: Array<{ topic: string; payload: unknown }> = [];
  const _markProcessedMock = vi.fn(async () => true);
  const _insertRuleMock = vi.fn(async () => undefined);
  const _setRuleEnabledMock = vi.fn(async () => undefined);
  const _cacheInvalidateMock = vi.fn(async () => undefined);
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn as any,
    enqueuedMessages: _enqueuedMessages,
    markProcessedMock: _markProcessedMock,
    insertRuleMock: _insertRuleMock,
    setRuleEnabledMock: _setRuleEnabledMock,
    cacheInvalidateMock: _cacheInvalidateMock,
  };
});

vi.mock("../src/shared/db.js", () => ({ db: { transaction: dbTransactionFn } }));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: { topic: string; payload: unknown }) => { enqueuedMessages.push({ topic: msg.topic, payload: msg.payload }); }),
  markProcessed: (...a: any[]) => markProcessedMock(...a),
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: { invalidate: (...a: any[]) => cacheInvalidateMock(...a), makeKey: (...parts: string[]) => parts.join(":") },
}));
vi.mock("../src/modules/alerts/repo.js", () => ({
  insertRule: (...a: any[]) => insertRuleMock(...a),
  setRuleEnabled: (...a: any[]) => setRuleEnabledMock(...a),
}));
vi.mock("../src/shared/tenant-queue.js", () => ({
  tenantScoped: (q: any) => q, // pass-through in test
}));

import { registerAlertConsumers } from "../src/modules/alerts/consumer.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
const AUDIT_TOPIC = "audit.event.record";

function makeMsg(type: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR,
    correlationId: `corr-${randomUUID()}`, schemaVersion: "1.0", payload,
  };
}
const settle = () => new Promise<void>((r) => setTimeout(r, 100));

beforeEach(() => {
  vi.clearAllMocks();
  enqueuedMessages.length = 0;
  markProcessedMock.mockResolvedValue(true);
});

// ─── 1. createAlertRule ──────────────────────────────────────────────────────

describe("createAlertRule command", () => {
  it("inserts rule with correct fields and emits events", async () => {
    const q = new MemoryQueue();
    registerAlertConsumers(q);
    await q.start();

    const ruleId = randomUUID();
    await q.publish("notification.alert_rule.create", makeMsg("notification.alert_rule.create", {
      id: ruleId, tenantId: TENANT, name: "Budget Breach Alert",
      triggerEvent: "finance.budget.breached", conditions: { threshold: 90 },
      channel: "email", recipients: ["officer-001"],
    }));
    await settle();

    // Rule inserted
    expect(insertRuleMock).toHaveBeenCalledOnce();
    const insertedRow = insertRuleMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(insertedRow.id).toBe(ruleId);
    expect(insertedRow.tenantId).toBe(TENANT);
    expect(insertedRow.name).toBe("Budget Breach Alert");
    expect(insertedRow.triggerEvent).toBe("finance.budget.breached");
    expect(insertedRow.enabled).toBe(true);
    expect(insertedRow.createdBy).toBe(ACTOR);

    // alertRuleCreated event emitted
    const createdEvt = enqueuedMessages.find((m) => m.topic === "notification.alert_rule.created");
    expect(createdEvt).toBeDefined();
    expect((createdEvt!.payload as any).ruleId).toBe(ruleId);

    // Audit event emitted
    const auditEvt = enqueuedMessages.find((m) => m.topic === AUDIT_TOPIC);
    expect(auditEvt).toBeDefined();
    const auditPayload = auditEvt!.payload as Record<string, unknown>;
    expect(auditPayload.service).toBe("notification");
    expect(auditPayload.action).toBe("create_alert_rule");
    expect(auditPayload.resourceType).toBe("alert_rule");
    expect(auditPayload.resourceId).toBe(ruleId);

    // Cache invalidated
    expect(cacheInvalidateMock).toHaveBeenCalledWith(`${TENANT}:alert_rule:list`);

    await q.stop();
  });
});

// ─── 2. enableAlertRule / disableAlertRule ────────────────────────────────────

describe("enableAlertRule command", () => {
  it("sets enabled=true and emits audit", async () => {
    const q = new MemoryQueue();
    registerAlertConsumers(q);
    await q.start();

    const ruleId = randomUUID();
    await q.publish("notification.alert_rule.enable", makeMsg("notification.alert_rule.enable", { id: ruleId, enabled: true }));
    await settle();

    expect(setRuleEnabledMock).toHaveBeenCalledWith(expect.anything(), ruleId, true, ACTOR);

    const auditEvt = enqueuedMessages.find((m) => m.topic === AUDIT_TOPIC);
    expect(auditEvt).toBeDefined();
    expect((auditEvt!.payload as any).action).toBe("enable_alert_rule");

    // Cache invalidated for both list and specific rule
    expect(cacheInvalidateMock).toHaveBeenCalledTimes(2);

    await q.stop();
  });
});

describe("disableAlertRule command", () => {
  it("sets enabled=false and emits audit", async () => {
    const q = new MemoryQueue();
    registerAlertConsumers(q);
    await q.start();

    const ruleId = randomUUID();
    await q.publish("notification.alert_rule.disable", makeMsg("notification.alert_rule.disable", { id: ruleId, enabled: false }));
    await settle();

    expect(setRuleEnabledMock).toHaveBeenCalledWith(expect.anything(), ruleId, false, ACTOR);

    const auditEvt = enqueuedMessages.find((m) => m.topic === AUDIT_TOPIC);
    expect((auditEvt!.payload as any).action).toBe("disable_alert_rule");

    await q.stop();
  });
});

// ─── 3. Idempotency ─────────────────────────────────────────────────────────

describe("idempotency — duplicate message skipped", () => {
  it("when markProcessed returns false, no insert/events", async () => {
    markProcessedMock.mockResolvedValue(false);

    const q = new MemoryQueue();
    registerAlertConsumers(q);
    await q.start();

    await q.publish("notification.alert_rule.create", makeMsg("notification.alert_rule.create", {
      id: randomUUID(), tenantId: TENANT, name: "Dup", triggerEvent: "x",
      conditions: {}, channel: "sms", recipients: [],
    }));
    await settle();

    expect(insertRuleMock).not.toHaveBeenCalled();
    expect(enqueuedMessages.length).toBe(0);

    await q.stop();
  });
});

// ─── 4. Tenant scoping ──────────────────────────────────────────────────────

describe("tenant isolation", () => {
  it("rule insert carries the message tenantId", async () => {
    const q = new MemoryQueue();
    registerAlertConsumers(q);
    await q.start();

    await q.publish("notification.alert_rule.create", makeMsg("notification.alert_rule.create", {
      id: randomUUID(), tenantId: TENANT, name: "Scoped",
      triggerEvent: "test.event", conditions: {}, channel: "push", recipients: [],
    }));
    await settle();

    const row = insertRuleMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(row.tenantId).toBe(TENANT);

    await q.stop();
  });
});
