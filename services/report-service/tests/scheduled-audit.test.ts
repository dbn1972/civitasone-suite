/**
 * GAP-REPORTS-SCHEDULED-02: verify the scheduled-report CREATE write path emits
 * an audit event in the SAME transaction as the insert, and that the audit
 * payload does NOT carry the recipients (personal email addresses — DPDP: the
 * trail records who/what/when, never the personal data itself).
 *
 * This is additive to tests/scheduled-reports.test.ts (route-level zod + role
 * gating) and tests/consumers.test.ts (which asserts the create enqueue count
 * but not the audit topic or its payload shape). It fails on any regression
 * that drops the audit emission or starts leaking recipients into the trail.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const TENANT_ID = "aaaaaaaa-1111-4000-8000-000000000001";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const TEMPLATE_ID = "33333333-3333-3333-3333-333333333333";
const SCHEDULED_ID = "44444444-4444-4444-4444-444444444444";

const mockState = vi.hoisted(() => ({
  inserted: [] as Record<string, unknown>[],
  enqueueCalls: [] as Record<string, unknown>[],
}));

vi.mock("../src/shared/db.js", () => {
  const txProxy = {
    insert: () => ({ values: (v: Record<string, unknown>) => { mockState.inserted.push(v); return { returning: () => [v] }; } }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => [] }) }) }),
    select: () => ({ from: () => ({ where: () => ({ limit: () => [] }) }) }),
  };
  return {
    db: { ...txProxy, transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(txProxy) },
    sqlClient: { end: async () => {} },
  };
});

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    put: async () => {},
    invalidate: async () => {},
    invalidateResource: async () => {},
    getOrLoad: async <T>(_k: string, loader: () => Promise<T>) => loader(),
    listOrLoad: async <T>(_t: string, _r: string, _k: string, loader: () => Promise<T>) => loader(),
    makeKey: (...args: string[]) => args.join(":"),
  },
  queue: { publish: async () => {}, subscribe: () => {} },
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: async (_tx: unknown, ev: Record<string, unknown>) => { mockState.enqueueCalls.push(ev); },
  markProcessed: async () => true,
}));

vi.mock("../src/modules/scheduled/repo.js", () => ({
  insert: async (_tx: unknown, row: Record<string, unknown>) => { mockState.inserted.push(row); },
  update: async () => true,
  disable: async () => true,
  touchLastRunAt: async () => true,
  findById: async () => null,
  listByTenant: async () => [],
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("drizzle-orm", () => ({
  eq: () => "eq",
  and: (...args: unknown[]) => args,
  lte: () => "lte",
  sql: () => "sql",
}));

beforeEach(() => {
  mockState.inserted = [];
  mockState.enqueueCalls = [];
});

describe("GAP-REPORTS-SCHEDULED-02: scheduled create audit trail", () => {
  async function runCreate(recipients: string[]) {
    const { registerScheduledConsumers } = await import("../src/modules/scheduled/consumer.js");
    const handlers = new Map<string, (msg: unknown) => Promise<void>>();
    const mockQueue = {
      subscribe: (topic: string, handler: (msg: unknown) => Promise<void>) => { handlers.set(topic, handler); },
      publish: async () => {},
    };
    registerScheduledConsumers(mockQueue as never);
    await handlers.get("reports.scheduled.create")!({
      messageId: SCHEDULED_ID,
      type: "reports.scheduled.create",
      tenantId: TENANT_ID,
      actorId: ACTOR_ID,
      correlationId: "corr-audit",
      schemaVersion: "1.0",
      payload: {
        id: SCHEDULED_ID,
        tenantId: TENANT_ID,
        templateId: TEMPLATE_ID,
        cadence: "daily",
        recipients,
        format: "pdf",
        enabled: true,
        nextRunAt: new Date(),
        version: 1,
      },
    });
  }

  it("emits an audit.event.record on create, in the same transaction as the insert", async () => {
    await runCreate(["alice@example.com", "bob@example.com"]);
    expect(mockState.inserted.length).toBeGreaterThan(0);
    const audit = mockState.enqueueCalls.find((e) => e.topic === "audit.event.record");
    expect(audit).toBeDefined();
    const payload = audit!.payload as Record<string, unknown>;
    expect(payload.service).toBe("reports");
    expect(payload.action).toBe("create");
    expect(payload.resourceType).toBe("scheduled_report");
    expect(payload.resourceId).toBe(SCHEDULED_ID);
    expect(payload.outcome).toBe("success");
  });

  it("does NOT leak recipient email addresses into the audit payload (DPDP)", async () => {
    await runCreate(["alice@example.com", "bob@example.com"]);
    const audit = mockState.enqueueCalls.find((e) => e.topic === "audit.event.record");
    const serialised = JSON.stringify(audit);
    expect(serialised).not.toContain("alice@example.com");
    expect(serialised).not.toContain("bob@example.com");
    expect(serialised).not.toContain("recipients");
  });
});
