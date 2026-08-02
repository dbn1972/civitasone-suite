/**
 * FP T1-03: gap-routes.ts CQRS conversion.
 *
 * The 8 mutating routes in payroll/gap-routes.ts previously performed
 * synchronous db.execute() INSERT/UPDATE in the request path and returned 201.
 * They now publish a command and return 202; the write happens in an
 * idempotent consumer registered by registerPayrollConsumers.
 *
 * Coverage mirrors world-class-cqrs.test.ts:
 *   1. Static source check — every mutating route uses sendAccepted (no
 *      reply.code(201) synchronous writes).
 *   2. Publisher — commands.ts publishes to the correct COMMANDS topic and
 *      does NOT persist inline.
 *   3. Consumer — the subscribed handler persists via markProcessed + tx.execute
 *      and enqueues the paired *ed event; redelivery is a no-op.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TENANT = "aaaaaaaa-7103-4000-8000-000000000103";
const ACTOR = "00000000-0103-4000-8000-000000000001";
const EMPLOYEE = "00000000-0103-4000-8000-0000000000e1";
const PLAN_ID = "00000000-0103-4000-8000-00000000f1a1";
const COST_CENTER = "00000000-0103-4000-8000-00000000cc01";

describe("FP T1-03 static source check: mutating gap routes use sendAccepted (202)", () => {
  const src = readFileSync(join(__dirname, "../src/modules/payroll/gap-routes.ts"), "utf8");

  const cases: Array<[string, string, string]> = [
    ["POST /v1/payroll/corrections",                    "corrections",                 "commands.createCorrection"],
    ["POST /v1/payroll/pay-groups",                     "pay-groups",                  "commands.createPayGroup"],
    ["POST /v1/payroll/flex-benefits/plans",            "flex-benefits/plans",         "commands.createFlexPlan"],
    ["POST /v1/payroll/flex-benefits/elections",        "flex-benefits/elections",     "commands.upsertFlexElection"],
    ["POST /v1/payroll/costing/rules",                  "costing/rules",               "commands.upsertCostingRule"],
    ["POST /v1/payroll/off-cycle",                      "off-cycle\",",                "commands.createOffCycle"],
    ["POST /v1/payroll/off-cycle/:id/process",          "off-cycle/:id/process",       "commands.processOffCycle"],
    ["POST /v1/payroll/statutory/state-rules",          "statutory/state-rules",       "commands.upsertStateRules"],
  ];

  for (const [label, urlFragment, publisher] of cases) {
    it(`${label} publishes via ${publisher} and returns via sendAccepted`, () => {
      const routeRe = new RegExp(`app\\.post\\("\\/v1\\/payroll\\/${urlFragment.replace(/[\\/:.-]/g, "\\$&")}[\\s\\S]{0,1500}?\\}\\);`);
      const m = routeRe.exec(src);
      expect(m, `${label} handler not found`).not.toBeNull();
      expect(m![0]).toContain("sendAccepted");
      expect(m![0]).toContain(publisher);
      expect(m![0]).not.toMatch(/reply\.code\(201\)/);
    });
  }

  it("gap-routes.ts contains zero synchronous db.execute/insert/update calls", () => {
    // Same acceptance grep as the FP card, scoped to this one file.
    const matches = src.match(/db\.(execute|insert|update)|\.insert\s*\(/g);
    expect(matches ?? []).toHaveLength(0);
  });
});

// ─── publisher topic + consumer persistence (mocked) ────────────────────────
const mockPublish = vi.fn().mockResolvedValue(undefined);
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
  execute: (query: unknown) => {
    executedQueries.push(query);
    // off-cycle process consumer reads items first; return one row so the
    // UPDATE branch is exercised.
    return Promise.resolve([{ id: "item-1", employee_id: EMPLOYEE, amount_minor: "1000000" }]);
  },
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

function paramsOf(query: any): unknown[] {
  return (query.queryChunks as unknown[]).filter(
    (c) => !(c && typeof c === "object" && Array.isArray((c as { value?: unknown }).value)),
  );
}

const baseMsg = { tenantId: TENANT, actorId: ACTOR, correlationId: "corr-T1-03", schemaVersion: "1.0" };
const baseCtx = {
  tenantId: TENANT, actorId: ACTOR, correlationId: "corr-T1-03",
  roles: ["payroll_admin"], sessionId: "s-1", actorType: "user",
} as any;

beforeEach(() => {
  mockPublish.mockClear();
  executedQueries.length = 0;
  mockEnqueued.length = 0;
  mockMarkResult = true;
});

describe("FP T1-03 correction CQRS", () => {
  it("createCorrection publishes to COMMANDS.correctionCreate", async () => {
    const { createCorrection } = await import("../src/modules/payroll/commands.js");
    const { COMMANDS } = await import("../src/topics.js");
    const result = await createCorrection(baseCtx, {
      employeeId: EMPLOYEE, component: "BASIC", effectiveFrom: "2026-04-01",
      oldValueMinor: 3000000, newValueMinor: 3500000,
      affectedPeriods: 4, arrearsMinor: "2000000",
    });
    expect(mockPublish).toHaveBeenCalledTimes(1);
    const [topic, msg] = mockPublish.mock.calls[0];
    expect(topic).toBe(COMMANDS.correctionCreate);
    expect(msg.payload.arrearsMinor).toBe("2000000");
    expect(result.status).toBe("accepted");
  });

  it("consumer persists the correction row and fires correctionCreated", async () => {
    const { registerPayrollConsumers } = await import("../src/modules/payroll/consumer.js");
    const { COMMANDS, EVENTS } = await import("../src/topics.js");
    const handlers: Record<string, (msg: unknown) => Promise<void>> = {};
    const q = { subscribe: (t: string, fn: (msg: unknown) => Promise<void>) => { handlers[t] = fn; } } as any;
    registerPayrollConsumers(q);
    await handlers[COMMANDS.correctionCreate]({
      ...baseMsg, messageId: "m-corr-1",
      payload: {
        id: "corr-1", tenantId: TENANT, employeeId: EMPLOYEE, component: "BASIC",
        effectiveFrom: "2026-04-01", oldValueMinor: 3000000, newValueMinor: 3500000,
        arrearsMinor: "2000000", affectedPeriods: 4, reason: "arrears",
      },
    });
    expect(executedQueries).toHaveLength(1);
    const params = paramsOf(executedQueries[0]);
    expect(params).toContain(EMPLOYEE);
    expect(params).toContain("BASIC");
    expect(mockEnqueued.some((e) => e.topic === EVENTS.correctionCreated)).toBe(true);
  });

  it("is idempotent on redelivery", async () => {
    mockMarkResult = false;
    const { registerPayrollConsumers } = await import("../src/modules/payroll/consumer.js");
    const { COMMANDS } = await import("../src/topics.js");
    const handlers: Record<string, (msg: unknown) => Promise<void>> = {};
    const q = { subscribe: (t: string, fn: (msg: unknown) => Promise<void>) => { handlers[t] = fn; } } as any;
    registerPayrollConsumers(q);
    await handlers[COMMANDS.correctionCreate]({
      ...baseMsg, messageId: "m-corr-dup",
      payload: {
        id: "corr-dup", tenantId: TENANT, employeeId: EMPLOYEE, component: "BASIC",
        effectiveFrom: "2026-04-01", oldValueMinor: 100, newValueMinor: 200,
        arrearsMinor: "400", affectedPeriods: 4,
      },
    });
    expect(executedQueries).toHaveLength(0);
    expect(mockEnqueued).toHaveLength(0);
  });
});

describe("FP T1-03 pay-group CQRS", () => {
  it("createPayGroup publishes to COMMANDS.payGroupCreate", async () => {
    const { createPayGroup } = await import("../src/modules/payroll/commands.js");
    const { COMMANDS } = await import("../src/topics.js");
    await createPayGroup(baseCtx, { name: "Monthly", frequency: "monthly", payDayOfMonth: 28, timezone: "Asia/Kolkata" });
    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish.mock.calls[0][0]).toBe(COMMANDS.payGroupCreate);
  });

  it("consumer persists and fires payGroupCreated", async () => {
    const { registerPayrollConsumers } = await import("../src/modules/payroll/consumer.js");
    const { COMMANDS, EVENTS } = await import("../src/topics.js");
    const handlers: Record<string, (msg: unknown) => Promise<void>> = {};
    const q = { subscribe: (t: string, fn: (msg: unknown) => Promise<void>) => { handlers[t] = fn; } } as any;
    registerPayrollConsumers(q);
    await handlers[COMMANDS.payGroupCreate]({
      ...baseMsg, messageId: "m-pg-1",
      payload: { id: "pg-1", tenantId: TENANT, name: "Monthly", frequency: "monthly", payDayOfMonth: 28, timezone: "Asia/Kolkata" },
    });
    expect(executedQueries).toHaveLength(1);
    expect(mockEnqueued.some((e) => e.topic === EVENTS.payGroupCreated)).toBe(true);
  });
});

describe("FP T1-03 flex-benefit election CQRS", () => {
  it("upsertFlexElection publishes to COMMANDS.flexElectionUpsert with totalElectedMinor pre-summed", async () => {
    const { upsertFlexElection } = await import("../src/modules/payroll/commands.js");
    const { COMMANDS } = await import("../src/topics.js");
    await upsertFlexElection(baseCtx, {
      planId: PLAN_ID, fy: "2026-27",
      elections: [{ component: "MEAL", electedMinor: 100000 }, { component: "FUEL", electedMinor: 200000 }],
      totalElectedMinor: 300000,
    });
    expect(mockPublish).toHaveBeenCalledTimes(1);
    const [topic, msg] = mockPublish.mock.calls[0];
    expect(topic).toBe(COMMANDS.flexElectionUpsert);
    expect(msg.payload.totalElectedMinor).toBe(300000);
  });
});

describe("FP T1-03 costing-rule CQRS", () => {
  it("upsertCostingRule publishes to COMMANDS.costingRuleUpsert", async () => {
    const { upsertCostingRule } = await import("../src/modules/payroll/commands.js");
    const { COMMANDS } = await import("../src/topics.js");
    await upsertCostingRule(baseCtx, { employeeGroup: "engineering", costCenterId: COST_CENTER, splitPct: 100 });
    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish.mock.calls[0][0]).toBe(COMMANDS.costingRuleUpsert);
  });
});

describe("FP T1-03 off-cycle create CQRS", () => {
  it("createOffCycle publishes to COMMANDS.offCycleCreate with totalAmountMinor as bigint string", async () => {
    const { createOffCycle } = await import("../src/modules/payroll/commands.js");
    const { COMMANDS } = await import("../src/topics.js");
    await createOffCycle(baseCtx, {
      runType: "bonus", period: "2026-04",
      totalAmountMinor: "1500000",
      items: [{ employeeId: EMPLOYEE, amountMinor: 1500000 }],
    });
    expect(mockPublish).toHaveBeenCalledTimes(1);
    const [topic, msg] = mockPublish.mock.calls[0];
    expect(topic).toBe(COMMANDS.offCycleCreate);
    expect(msg.payload.totalAmountMinor).toBe("1500000");
  });

  it("consumer persists run + items and fires offCycleCreated", async () => {
    const { registerPayrollConsumers } = await import("../src/modules/payroll/consumer.js");
    const { COMMANDS, EVENTS } = await import("../src/topics.js");
    const handlers: Record<string, (msg: unknown) => Promise<void>> = {};
    const q = { subscribe: (t: string, fn: (msg: unknown) => Promise<void>) => { handlers[t] = fn; } } as any;
    registerPayrollConsumers(q);
    await handlers[COMMANDS.offCycleCreate]({
      ...baseMsg, messageId: "m-oc-1",
      payload: {
        id: "oc-1", tenantId: TENANT, runType: "bonus", period: "2026-04",
        totalAmountMinor: "1500000",
        items: [{ employeeId: EMPLOYEE, amountMinor: 1500000 }],
      },
    });
    // 1 run insert + 1 item insert = 2 queries.
    expect(executedQueries).toHaveLength(2);
    expect(mockEnqueued.some((e) => e.topic === EVENTS.offCycleCreated)).toBe(true);
  });
});

describe("FP T1-03 off-cycle process CQRS (tax computed in consumer)", () => {
  it("processOffCycle publishes to COMMANDS.offCycleProcess without tax numbers", async () => {
    const { processOffCycle } = await import("../src/modules/payroll/commands.js");
    const { COMMANDS } = await import("../src/topics.js");
    await processOffCycle(baseCtx, "oc-1");
    expect(mockPublish).toHaveBeenCalledTimes(1);
    const [topic, msg] = mockPublish.mock.calls[0];
    expect(topic).toBe(COMMANDS.offCycleProcess);
    // Handler must NOT ship pre-computed tax — the consumer is the source of truth.
    expect(msg.payload.totalTaxMinor).toBeUndefined();
    expect(msg.payload.totalNetMinor).toBeUndefined();
  });

  it("consumer computes 30% flat tax and fires offCycleProcessed", async () => {
    const { registerPayrollConsumers } = await import("../src/modules/payroll/consumer.js");
    const { COMMANDS, EVENTS } = await import("../src/topics.js");
    const handlers: Record<string, (msg: unknown) => Promise<void>> = {};
    const q = { subscribe: (t: string, fn: (msg: unknown) => Promise<void>) => { handlers[t] = fn; } } as any;
    registerPayrollConsumers(q);
    await handlers[COMMANDS.offCycleProcess]({
      ...baseMsg, messageId: "m-ocp-1",
      payload: { id: "oc-1", tenantId: TENANT },
    });
    // 1 SELECT (items) + 1 UPDATE (item) + 1 UPDATE (run) = 3 queries.
    expect(executedQueries.length).toBe(3);
    const domainEvent = mockEnqueued.find((e) => e.topic === EVENTS.offCycleProcessed);
    expect(domainEvent).toBeDefined();
    // Mock tx returned one item with amount_minor "1000000"; tax = 300000, net = 700000.
    expect((domainEvent!.payload as { totalTaxMinor: string }).totalTaxMinor).toBe("300000");
    expect((domainEvent!.payload as { totalNetMinor: string }).totalNetMinor).toBe("700000");
  });
});

describe("FP T1-03 state-rules CQRS", () => {
  it("upsertStateRules publishes to COMMANDS.stateRulesUpsert", async () => {
    const { upsertStateRules } = await import("../src/modules/payroll/commands.js");
    const { COMMANDS } = await import("../src/topics.js");
    const result = await upsertStateRules(baseCtx, {
      stateCode: "KA",
      ptSlabs: [{ fromMinor: 0, toMinor: 1500000, taxMinor: 20000 }],
      lwfEmployee: 2000, lwfEmployer: 4000,
    });
    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish.mock.calls[0][0]).toBe(COMMANDS.stateRulesUpsert);
    // Accepted envelope's id is the stateCode natural key (no surrogate uuid).
    expect(result.id).toBe("KA");
  });
});
