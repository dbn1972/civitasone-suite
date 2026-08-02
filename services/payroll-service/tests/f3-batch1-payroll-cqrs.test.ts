import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TENANT = "aaaaaaaa-f301-4000-8000-000000000001";
const ACTOR = "00000000-f301-4000-8000-000000000001";
const EMPLOYEE = "00000000-f301-4000-8000-0000000000e1";

describe("F3 batch 1 route CQRS acceptance", () => {
  const taxRoutes = readFileSync(join(__dirname, "../src/modules/tax/routes.ts"), "utf8");
  const form16Routes = readFileSync(join(__dirname, "../src/modules/form16-pdf/routes.ts"), "utf8");
  const statutoryRoutes = readFileSync(join(__dirname, "../src/modules/statutory-returns/routes.ts"), "utf8");

  const routeSource = (source: string, marker: string): string => {
    const start = source.indexOf(marker);
    expect(start, `${marker} handler not found`).toBeGreaterThanOrEqual(0);
    return source.slice(start, source.indexOf("\n  });", start) + 6);
  };

  it("ceiling upsert validates, publishes, and returns accepted without a route write", () => {
    const route = routeSource(taxRoutes, 'app.put("/v1/payroll/tax/exemption-ceilings"');
    expect(route).toContain("upsertCeilingBody.parse(req.body)");
    expect(route).toContain("commands.upsertExemptionCeiling");
    expect(route).toContain("sendAccepted");
    expect(route).not.toContain("db.transaction");
    expect(route).not.toMatch(/\.insert\s*\(/);
  });

  it("bulk Form 16 route publishes a messageId and returns accepted without creating a job", () => {
    const route = routeSource(form16Routes, 'app.post("/v1/payroll/tax/form16/bulk-generate"');
    expect(route).toContain("messageId: jobId");
    expect(route).toContain("sendAccepted");
    expect(route).not.toContain("db.transaction");
    expect(route).not.toMatch(/\.insert\s*\(\s*form16BulkJobs/);
  });

  it("perquisite upsert has zod validation and no synchronous insert", () => {
    const route = routeSource(statutoryRoutes, 'app.post("/v1/payroll/statutory/perquisite-components"');
    expect(route).toContain("perquisiteComponentBody.parse(req.body)");
    expect(route).toContain("taxCommands.upsertPerquisiteComponent");
    expect(route).toContain("sendAccepted");
    expect(route).not.toContain("db.transaction");
    expect(route).not.toMatch(/\.insert\s*\(/);
    expect(route).not.toContain("req.body as");
  });
});

const mockPublish = vi.fn().mockResolvedValue(undefined);
const mockMarkProcessed = vi.fn().mockResolvedValue(true);
const mockEnqueue = vi.fn().mockResolvedValue(undefined);
const writes: Array<Record<string, unknown>> = [];

const mockTx = {
  insert: () => ({
    values: (values: Record<string, unknown>) => {
      writes.push(values);
      return {
        onConflictDoUpdate: () => Promise.resolve(),
      };
    },
  }),
};

vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: mockPublish },
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: (fn: (tx: typeof mockTx) => Promise<void>) => fn(mockTx) },
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: mockMarkProcessed,
  enqueue: mockEnqueue,
}));

vi.mock("../src/modules/fnf/schema.js", () => ({
  exemptionCeilings: {
    id: "id",
    fyStartYear: "fyStartYear",
    section: "section",
    ceilingMinor: "ceilingMinor",
    notes: "notes",
  },
}));

vi.mock("../src/modules/tax/schema.js", () => ({
  taxDeclarations: {},
  perquisiteComponents: {
    id: "id",
    tenantId: "tenantId",
    employeeId: "employeeId",
    fy: "fy",
    nature: "nature",
    description: "description",
    valueByEmployerMinor: "valueByEmployerMinor",
    amountRecoveredMinor: "amountRecoveredMinor",
    taxableValueMinor: "taxableValueMinor",
    createdBy: "createdBy",
  },
}));

beforeEach(() => {
  mockPublish.mockClear();
  mockMarkProcessed.mockClear();
  mockEnqueue.mockClear();
  mockMarkProcessed.mockResolvedValue(true);
  writes.length = 0;
});

const ctx = {
  tenantId: TENANT,
  actorId: ACTOR,
  correlationId: "corr-f3-batch1",
  roles: ["payroll_admin"],
  sessionId: "s-f3",
  actorType: "user",
} as any;

describe("F3 batch 1 tax command publishers and consumers", () => {
  it("publishes and persists an exemption ceiling through the idempotent consumer", async () => {
    const { upsertExemptionCeiling } = await import("../src/modules/tax/commands.js");
    const { registerTaxConsumers } = await import("../src/modules/tax/consumer.js");
    const { COMMANDS, EVENTS } = await import("../src/topics.js");

    const accepted = await upsertExemptionCeiling(ctx, {
      fyStartYear: 2026,
      section: "10_10",
      ceilingMinor: "2500000",
      notes: "test",
    });
    expect(mockPublish).toHaveBeenCalledWith(COMMANDS.exemptionCeilingUpsert, expect.objectContaining({
      messageId: accepted.id,
      payload: expect.objectContaining({ id: accepted.id, ceilingMinor: "2500000" }),
    }));

    const handlers: Record<string, (msg: any) => Promise<void>> = {};
    registerTaxConsumers({ subscribe: (topic: string, handler: (msg: any) => Promise<void>) => { handlers[topic] = handler; } } as any);
    await handlers[COMMANDS.exemptionCeilingUpsert]({
      messageId: "ceiling-message",
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: ctx.correlationId,
      payload: { id: "ceiling-1", fyStartYear: 2026, section: "10_10", ceilingMinor: "2500000" },
    });

    expect(mockMarkProcessed).toHaveBeenCalledWith(mockTx, "ceiling-message");
    expect(writes).toContainEqual(expect.objectContaining({ id: "ceiling-1", ceilingMinor: 2500000n }));
    expect(mockEnqueue).toHaveBeenCalledWith(mockTx, expect.objectContaining({ topic: EVENTS.exemptionCeilingUpserted }));
  });

  it("publishes and persists a perquisite component through the idempotent consumer", async () => {
    const { upsertPerquisiteComponent } = await import("../src/modules/tax/commands.js");
    const { registerTaxConsumers } = await import("../src/modules/tax/consumer.js");
    const { COMMANDS, EVENTS } = await import("../src/topics.js");

    const accepted = await upsertPerquisiteComponent(ctx, {
      employeeId: EMPLOYEE,
      fy: "2026-27",
      nature: "car",
      valueByEmployer: 1000,
      amountRecovered: 250,
    });
    expect(mockPublish).toHaveBeenCalledWith(COMMANDS.perquisiteComponentUpsert, expect.objectContaining({
      messageId: accepted.id,
      payload: expect.objectContaining({ employeeId: EMPLOYEE, valueByEmployer: 1000 }),
    }));

    const handlers: Record<string, (msg: any) => Promise<void>> = {};
    registerTaxConsumers({ subscribe: (topic: string, handler: (msg: any) => Promise<void>) => { handlers[topic] = handler; } } as any);
    await handlers[COMMANDS.perquisiteComponentUpsert]({
      messageId: "perquisite-message",
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: ctx.correlationId,
      payload: {
        id: "perquisite-1",
        employeeId: EMPLOYEE,
        fy: "2026-27",
        nature: "car",
        valueByEmployer: 1000,
        amountRecovered: 250,
      },
    });

    expect(mockMarkProcessed).toHaveBeenCalledWith(mockTx, "perquisite-message");
    expect(writes).toContainEqual(expect.objectContaining({
      id: "perquisite-1",
      taxableValueMinor: 75000n,
    }));
    expect(mockEnqueue).toHaveBeenCalledWith(mockTx, expect.objectContaining({ topic: EVENTS.perquisiteComponentUpserted }));
  });
});
