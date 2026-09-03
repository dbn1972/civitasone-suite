/**
 * Arrears / bonus-compute / reimbursement CQRS tests (quality-payroll-95
 * lift, mirrors works-service #354 masters-cqrs.test.ts / this service's own
 * ddo-pensioner-cqrs.test.ts).
 *
 * world-class-routes.ts POST /v1/payroll/arrears, /v1/payroll/bonus/compute,
 * and /v1/payroll/reimbursements used to write synchronously (raw SQL INSERT,
 * with the bonus amount computed in the HTTP handler for bonus/compute).
 * These tests assert the full CQRS chain:
 *   1. Route: each handler calls sendAccepted (202), never a synchronous
 *      reply.code(201) insert — a static source check (see
 *      ddo-pensioner-cqrs.test.ts for why this is static rather than a live
 *      buildApp() HTTP call in this same file).
 *   2. Publisher: commands.ts publishes to the correct COMMANDS topic.
 *   3. Consumer: the registered handler persists the row (bonusAmountMinor is
 *      COMPUTED IN THE CONSUMER, not trusted from the request) and fires the
 *      paired *ed event, idempotently (markProcessed returning false skips
 *      the insert + event).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TENANT = "aaaaaaaa-9595-4000-8000-000000000095";
const ACTOR = "00000000-0095-4000-8000-000000000002";
const EMPLOYEE = "00000000-0095-4000-8000-0000000000e1";

describe("Route: arrears/bonus/reimbursement CQRS handlers use sendAccepted (202)", () => {
  const src = readFileSync(join(__dirname, "../src/modules/payroll/world-class-routes.ts"), "utf8");

  it("POST /v1/payroll/arrears calls sendAccepted(...) with commands.createArrear", () => {
    const m = /app\.post\("\/v1\/payroll\/arrears",\s*async[\s\S]{0,400}?\}\);/.exec(src);
    expect(m).not.toBeNull();
    expect(m![0]).toContain("sendAccepted");
    expect(m![0]).toContain("commands.createArrear");
    expect(m![0]).not.toMatch(/reply\.code\(201\)/);
  });

  it("POST /v1/payroll/bonus/compute calls sendAccepted(...) with commands.computeBonus (no amount computed inline)", () => {
    const m = /app\.post\("\/v1\/payroll\/bonus\/compute",\s*async[\s\S]{0,400}?\}\);/.exec(src);
    expect(m).not.toBeNull();
    expect(m![0]).toContain("sendAccepted");
    expect(m![0]).toContain("commands.computeBonus");
    expect(m![0]).not.toMatch(/reply\.code\(201\)/);
    // The bonusAmountMinor multiplication must NOT happen in the route handler.
    expect(m![0]).not.toMatch(/bonusPct\s*\/\s*100/);
  });

  it("POST /v1/payroll/reimbursements calls sendAccepted(...) with commands.createReimbursement", () => {
    const m = /app\.post\("\/v1\/payroll\/reimbursements",\s*async[\s\S]{0,400}?\}\);/.exec(src);
    expect(m).not.toBeNull();
    expect(m![0]).toContain("sendAccepted");
    expect(m![0]).toContain("commands.createReimbursement");
    expect(m![0]).not.toMatch(/reply\.code\(201\)/);
  });
});

// ─── publisher topic + consumer persistence (mocked) ────────────────────────
const mockPublish = vi.fn().mockResolvedValue(undefined);
// External HRMS is unreachable in this service's isolated test env (no
// hrms-service running). commands.ts's assertEmployeeExists() (added by the
// round2 employee-existence review fix, commit 488e418e) now does a real
// synchronous HTTP existence check before publishing any arrear/bonus/
// reimbursement command, so without this stub every call here throws
// HrmsUnavailableError (502) before mockPublish is ever invoked.
vi.mock("../src/shared/hrms-client.js", () => ({
  verifyEmployeeExists: vi.fn(async () => true),
}));

vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: mockPublish, subscribe: vi.fn(), start: vi.fn(), stop: vi.fn() },
  cache: {
    getOrLoad: vi.fn((_k: string, fn: () => unknown) => fn()),
    invalidate: vi.fn(),
    invalidateResource: vi.fn(),
    makeKey: (...parts: string[]) => parts.join(":"),
    put: vi.fn(),
  },
}));

const executedQueries: unknown[] = [];
let mockMarkResult = true;
const mockTx: any = {
  execute: (query: unknown) => { executedQueries.push(query); return Promise.resolve([]); },
};

vi.mock("../src/shared/db.js", async () => {
  const actual = await vi.importActual<typeof import("../src/shared/db.js")>("../src/shared/db.js");
  return {
    ...actual,
    db: { transaction: (fn: (tx: unknown) => unknown) => fn(mockTx), execute: vi.fn() },
  };
});

const mockEnqueued: Array<{ topic: string; payload: unknown }> = [];
vi.mock("../src/shared/outbox.js", async () => {
  const actual = await vi.importActual<typeof import("../src/shared/outbox.js")>("../src/shared/outbox.js");
  return {
    ...actual,
    markProcessed: vi.fn(() => Promise.resolve(mockMarkResult)),
    enqueue: vi.fn((_tx: unknown, ev: { topic: string; payload: unknown }) => {
      mockEnqueued.push(ev);
      return Promise.resolve();
    }),
  };
});

/** Extract the interpolated bind values from a drizzle-orm sql`...` template. */
function paramsOf(query: any): unknown[] {
  return (query.queryChunks as unknown[]).filter(
    (c) => !(c && typeof c === "object" && Array.isArray((c as { value?: unknown }).value)),
  );
}

const baseMsg = { tenantId: TENANT, actorId: ACTOR, correlationId: "corr-95", schemaVersion: "1.0" };
const baseCtx = {
  tenantId: TENANT, actorId: ACTOR, correlationId: "corr-95",
  roles: ["payroll_admin"], sessionId: "s-1", actorType: "user",
} as any;

beforeEach(() => {
  mockPublish.mockClear();
  executedQueries.length = 0;
  mockEnqueued.length = 0;
  mockMarkResult = true;
});

describe("Arrear CQRS", () => {
  it("createArrear publishes to COMMANDS.arrearCreate", async () => {
    const { createArrear } = await import("../src/modules/payroll/commands.js");
    const { COMMANDS } = await import("../src/topics.js");

    const result = await createArrear(baseCtx, {
      employeeId: EMPLOYEE, componentCode: "DA", fromPeriod: "2026-01", toPeriod: "2026-06",
      oldAmountMinor: 3000000, newAmountMinor: 3500000, reason: "test",
    });

    expect(mockPublish).toHaveBeenCalledTimes(1);
    const [topic, msg] = mockPublish.mock.calls[0];
    expect(topic).toBe(COMMANDS.arrearCreate);
    expect(msg.payload.employeeId).toBe(EMPLOYEE);
    expect(msg.payload.oldAmountMinor).toBe(3000000);
    expect(msg.payload.newAmountMinor).toBe(3500000);
    expect(result.status).toBe("accepted");
  });

  it("consumer persists the arrear row (difference computed server-side) and fires arrearCreated", async () => {
    const { registerPayrollConsumers } = await import("../src/modules/payroll/consumer.js");
    const { COMMANDS, EVENTS } = await import("../src/topics.js");

    const handlers: Record<string, (msg: unknown) => Promise<void>> = {};
    const q = { subscribe: (t: string, fn: (msg: unknown) => Promise<void>) => { handlers[t] = fn; } } as any;
    registerPayrollConsumers(q);

    await handlers[COMMANDS.arrearCreate]({
      ...baseMsg, messageId: "m-arr-1",
      payload: {
        id: "arr-1", tenantId: TENANT, employeeId: EMPLOYEE, componentCode: "DA",
        fromPeriod: "2026-01", toPeriod: "2026-06", oldAmountMinor: 3000000, newAmountMinor: 3500000,
        reason: "test",
      },
    });

    expect(executedQueries).toHaveLength(1);
    const params = paramsOf(executedQueries[0]);
    expect(params).toContain(EMPLOYEE);
    // difference_minor = newAmountMinor - oldAmountMinor, computed by the consumer.
    expect(params).toContain(500000);

    expect(mockEnqueued.some((e) => e.topic === EVENTS.arrearCreated)).toBe(true);
  });

  it("is idempotent on redelivery (markProcessed returns false)", async () => {
    mockMarkResult = false;
    const { registerPayrollConsumers } = await import("../src/modules/payroll/consumer.js");
    const { COMMANDS } = await import("../src/topics.js");

    const handlers: Record<string, (msg: unknown) => Promise<void>> = {};
    const q = { subscribe: (t: string, fn: (msg: unknown) => Promise<void>) => { handlers[t] = fn; } } as any;
    registerPayrollConsumers(q);

    await handlers[COMMANDS.arrearCreate]({
      ...baseMsg, messageId: "m-arr-dup",
      payload: { id: "arr-dup", tenantId: TENANT, employeeId: EMPLOYEE, componentCode: "DA", fromPeriod: "2026-01", toPeriod: "2026-06", oldAmountMinor: 100, newAmountMinor: 200 },
    });

    expect(executedQueries).toHaveLength(0);
    expect(mockEnqueued).toHaveLength(0);
  });
});

describe("Bonus compute CQRS", () => {
  it("computeBonus publishes to COMMANDS.bonusCompute WITHOUT a precomputed bonusAmountMinor", async () => {
    const { computeBonus } = await import("../src/modules/payroll/commands.js");
    const { COMMANDS } = await import("../src/topics.js");

    const result = await computeBonus(baseCtx, { employeeId: EMPLOYEE, fy: "2026-27", basicMinor: 8000000, bonusPct: 8.33 });

    expect(mockPublish).toHaveBeenCalledTimes(1);
    const [topic, msg] = mockPublish.mock.calls[0];
    expect(topic).toBe(COMMANDS.bonusCompute);
    expect(msg.payload.basicMinor).toBe(8000000);
    expect(msg.payload.bonusPct).toBe(8.33);
    // The publisher must NOT ship a pre-computed amount — the consumer is the
    // single source of truth for the calculation.
    expect(msg.payload.bonusAmountMinor).toBeUndefined();
    expect(result.status).toBe("accepted");
  });

  it("consumer computes bonusAmountMinor = basicMinor * bonusPct / 100 and persists it, firing bonusComputed", async () => {
    const { registerPayrollConsumers } = await import("../src/modules/payroll/consumer.js");
    const { COMMANDS, EVENTS } = await import("../src/topics.js");

    const handlers: Record<string, (msg: unknown) => Promise<void>> = {};
    const q = { subscribe: (t: string, fn: (msg: unknown) => Promise<void>) => { handlers[t] = fn; } } as any;
    registerPayrollConsumers(q);

    await handlers[COMMANDS.bonusCompute]({
      ...baseMsg, messageId: "m-bonus-1",
      payload: { id: "bonus-1", tenantId: TENANT, employeeId: EMPLOYEE, fy: "2026-27", basicMinor: 8000000, bonusPct: 8.33 },
    });

    expect(executedQueries).toHaveLength(1);
    const params = paramsOf(executedQueries[0]);
    const expectedBonus = Math.round((8000000 * 8.33) / 100);
    expect(params).toContain(expectedBonus);

    const domainEvent = mockEnqueued.find((e) => e.topic === EVENTS.bonusComputed);
    expect(domainEvent).toBeDefined();
    expect((domainEvent!.payload as { bonusAmountMinor: number }).bonusAmountMinor).toBe(expectedBonus);
  });

  it("is idempotent on redelivery (markProcessed returns false)", async () => {
    mockMarkResult = false;
    const { registerPayrollConsumers } = await import("../src/modules/payroll/consumer.js");
    const { COMMANDS } = await import("../src/topics.js");

    const handlers: Record<string, (msg: unknown) => Promise<void>> = {};
    const q = { subscribe: (t: string, fn: (msg: unknown) => Promise<void>) => { handlers[t] = fn; } } as any;
    registerPayrollConsumers(q);

    await handlers[COMMANDS.bonusCompute]({
      ...baseMsg, messageId: "m-bonus-dup",
      payload: { id: "bonus-dup", tenantId: TENANT, employeeId: EMPLOYEE, fy: "2026-27", basicMinor: 100, bonusPct: 1 },
    });

    expect(executedQueries).toHaveLength(0);
    expect(mockEnqueued).toHaveLength(0);
  });
});

describe("Reimbursement CQRS", () => {
  it("createReimbursement publishes to COMMANDS.reimbursementCreate", async () => {
    const { createReimbursement } = await import("../src/modules/payroll/commands.js");
    const { COMMANDS } = await import("../src/topics.js");

    const result = await createReimbursement(baseCtx, {
      employeeId: EMPLOYEE, category: "medical", amountMinor: 250000, period: "2026-07",
    } as any);

    expect(mockPublish).toHaveBeenCalledTimes(1);
    const [topic, msg] = mockPublish.mock.calls[0];
    expect(topic).toBe(COMMANDS.reimbursementCreate);
    expect(msg.payload.category).toBe("medical");
    expect(msg.payload.amountMinor).toBe(250000);
    expect(result.status).toBe("accepted");
  });

  it("consumer persists the reimbursement row and fires reimbursementCreated", async () => {
    const { registerPayrollConsumers } = await import("../src/modules/payroll/consumer.js");
    const { COMMANDS, EVENTS } = await import("../src/topics.js");

    const handlers: Record<string, (msg: unknown) => Promise<void>> = {};
    const q = { subscribe: (t: string, fn: (msg: unknown) => Promise<void>) => { handlers[t] = fn; } } as any;
    registerPayrollConsumers(q);

    await handlers[COMMANDS.reimbursementCreate]({
      ...baseMsg, messageId: "m-reimb-1",
      payload: { id: "reimb-1", tenantId: TENANT, employeeId: EMPLOYEE, category: "medical", amountMinor: 250000, period: "2026-07", billDate: null, billRef: null },
    });

    expect(executedQueries).toHaveLength(1);
    const params = paramsOf(executedQueries[0]);
    expect(params).toContain("medical");
    expect(params).toContain(250000);

    expect(mockEnqueued.some((e) => e.topic === EVENTS.reimbursementCreated)).toBe(true);
  });

  it("is idempotent on redelivery (markProcessed returns false)", async () => {
    mockMarkResult = false;
    const { registerPayrollConsumers } = await import("../src/modules/payroll/consumer.js");
    const { COMMANDS } = await import("../src/topics.js");

    const handlers: Record<string, (msg: unknown) => Promise<void>> = {};
    const q = { subscribe: (t: string, fn: (msg: unknown) => Promise<void>) => { handlers[t] = fn; } } as any;
    registerPayrollConsumers(q);

    await handlers[COMMANDS.reimbursementCreate]({
      ...baseMsg, messageId: "m-reimb-dup",
      payload: { id: "reimb-dup", tenantId: TENANT, employeeId: EMPLOYEE, category: "medical", amountMinor: 1, period: "2026-07" },
    });

    expect(executedQueries).toHaveLength(0);
    expect(mockEnqueued).toHaveLength(0);
  });
});
