/**
 * DDO + Pensioner CQRS tests (quality-payroll-95 lift, mirrors works-service
 * #354 masters-cqrs.test.ts).
 *
 * routes.ts POST /v1/payroll/ddos and POST /v1/payroll/pensioners used to
 * write synchronously (raw SQL INSERT / Drizzle insert) inside the request
 * handler. These tests assert the full CQRS chain:
 *   1. Route: the handler calls sendAccepted (202), never reply.code(201) —
 *      a static source check, kept in this file rather than a live buildApp()
 *      HTTP call, since Part 2/3 below mock ../src/shared/db.js and
 *      ../src/shared/infra.js file-wide (vi.mock is hoisted above imports),
 *      which would otherwise break a real app boot in the same file. The full
 *      live 201→202 HTTP assertions already live in payroll-core-routes.test.ts
 *      and payroll-routes.test.ts.
 *   2. Publisher: commands.ts publishes to the correct COMMANDS topic with the
 *      correct payload shape (ddoCode as `id` for DDOs; bigint fields
 *      stringified for pensioners).
 *   3. Consumer: the registered handler persists into the correct table and
 *      fires the paired *ed event, and is idempotent on redelivery
 *      (markProcessed returning false must skip the insert + event).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TENANT = "aaaaaaaa-9595-4000-8000-000000000095";
const ACTOR = "00000000-0095-4000-8000-000000000001";

describe("Route: DDO/pensioner CQRS handlers use sendAccepted (202), not a sync 201", () => {
  const src = readFileSync(join(__dirname, "../src/modules/payroll/routes.ts"), "utf8");

  it("POST /v1/payroll/ddos calls sendAccepted(...) with commands.upsertDdo", () => {
    const m = /app\.post\("\/v1\/payroll\/ddos",\s*async[\s\S]{0,400}?\}\);/.exec(src);
    expect(m).not.toBeNull();
    expect(m![0]).toContain("sendAccepted");
    expect(m![0]).toContain("commands.upsertDdo");
    expect(m![0]).not.toMatch(/reply\.code\(201\)/);
  });

  it("POST /v1/payroll/pensioners calls sendAccepted(...) with commands.createPensioner", () => {
    const m = /app\.post\("\/v1\/payroll\/pensioners",\s*async[\s\S]{0,400}?\}\);/.exec(src);
    expect(m).not.toBeNull();
    expect(m![0]).toContain("sendAccepted");
    expect(m![0]).toContain("commands.createPensioner");
    expect(m![0]).not.toMatch(/reply\.code\(201\)/);
  });
});

// ─── Part 2 + 3: publisher topic + consumer persistence (mocked) ────────────
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
const insertedTables: unknown[] = [];
const insertedValues: unknown[] = [];
let mockMarkResult = true;
const mockTx: any = {
  execute: (query: unknown) => { executedQueries.push(query); return Promise.resolve([]); },
  insert: (t: unknown) => {
    insertedTables.push(t);
    return {
      values: (v: unknown) => {
        insertedValues.push(v);
        return { onConflictDoNothing: () => Promise.resolve() };
      },
    };
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

/** Extract the interpolated bind values from a drizzle-orm sql`...` template. */
function paramsOf(query: any): unknown[] {
  return (query.queryChunks as unknown[]).filter(
    (c) => !(c && typeof c === "object" && Array.isArray((c as { value?: unknown }).value)),
  );
}

const baseMsg = {
  tenantId: TENANT, actorId: ACTOR, correlationId: "corr-95", schemaVersion: "1.0",
};

beforeEach(() => {
  mockPublish.mockClear();
  executedQueries.length = 0;
  insertedTables.length = 0;
  insertedValues.length = 0;
  mockEnqueued.length = 0;
  mockMarkResult = true;
});

const baseCtx = {
  tenantId: TENANT, actorId: ACTOR, correlationId: "corr-95",
  roles: ["payroll_admin"], sessionId: "s-1", actorType: "user",
} as any;

describe("DDO CQRS — publisher", () => {
  it("upsertDdo publishes to COMMANDS.ddoUpsert with the ddoCode/name/departmentIds", async () => {
    const { upsertDdo } = await import("../src/modules/payroll/commands.js");
    const { COMMANDS } = await import("../src/topics.js");

    const result = await upsertDdo(baseCtx, { ddoCode: "DDO-P1", name: "Treasury A", departmentIds: ["11111111-1111-4111-8111-111111111111"] });

    expect(mockPublish).toHaveBeenCalledTimes(1);
    const [topic, msg] = mockPublish.mock.calls[0];
    expect(topic).toBe(COMMANDS.ddoUpsert);
    expect(msg.payload.ddoCode).toBe("DDO-P1");
    expect(msg.payload.name).toBe("Treasury A");
    expect(msg.payload.departmentIds).toEqual(["11111111-1111-4111-8111-111111111111"]);
    // No surrogate id — the accepted envelope's id IS the ddoCode.
    expect(result).toEqual({ id: "DDO-P1", status: "accepted", correlationId: "corr-95" });
  });
});

describe("DDO CQRS — consumer persistence", () => {
  it("ddoUpsert inserts the ddo row + department mappings and fires ddoUpserted", async () => {
    const { registerPayrollConsumers } = await import("../src/modules/payroll/consumer.js");
    const { COMMANDS, EVENTS } = await import("../src/topics.js");

    const handlers: Record<string, (msg: unknown) => Promise<void>> = {};
    const q = { subscribe: (t: string, fn: (msg: unknown) => Promise<void>) => { handlers[t] = fn; } } as any;
    registerPayrollConsumers(q);

    await handlers[COMMANDS.ddoUpsert]({
      ...baseMsg, messageId: "m-ddo-1",
      payload: { tenantId: TENANT, ddoCode: "DDO-P2", name: "Treasury B", departmentIds: ["22222222-2222-4222-8222-222222222222"] },
    });

    // One INSERT for payroll_ddos + one for the department mapping.
    expect(executedQueries.length).toBe(2);
    const ddoParams = paramsOf(executedQueries[0]);
    expect(ddoParams).toContain(TENANT);
    expect(ddoParams).toContain("DDO-P2");
    expect(ddoParams).toContain("Treasury B");
    const deptParams = paramsOf(executedQueries[1]);
    expect(deptParams).toContain("22222222-2222-4222-8222-222222222222");

    // The consumer also enqueues an audit.event.record row alongside the
    // domain event — assert the domain event fired, not an exact count.
    expect(mockEnqueued.some((e) => e.topic === EVENTS.ddoUpserted)).toBe(true);
  });

  it("is idempotent on redelivery (markProcessed returns false → no insert, no event)", async () => {
    mockMarkResult = false;
    const { registerPayrollConsumers } = await import("../src/modules/payroll/consumer.js");
    const { COMMANDS } = await import("../src/topics.js");

    const handlers: Record<string, (msg: unknown) => Promise<void>> = {};
    const q = { subscribe: (t: string, fn: (msg: unknown) => Promise<void>) => { handlers[t] = fn; } } as any;
    registerPayrollConsumers(q);

    await handlers[COMMANDS.ddoUpsert]({
      ...baseMsg, messageId: "m-ddo-dup",
      payload: { tenantId: TENANT, ddoCode: "DDO-DUP", name: "Dup", departmentIds: [] },
    });

    expect(executedQueries).toHaveLength(0);
    expect(mockEnqueued).toHaveLength(0);
  });
});

describe("Pensioner CQRS — publisher", () => {
  it("createPensioner publishes to COMMANDS.pensionerCreate with bigint fields stringified", async () => {
    const { createPensioner } = await import("../src/modules/payroll/commands.js");
    const { COMMANDS } = await import("../src/topics.js");

    const result = await createPensioner(baseCtx, {
      ppoNo: "PPO-P1", fullName: "Test Pensioner", dateOfBirth: "1960-01-01",
      basicPensionMinor: 4500000n, taxRegime: "old",
    });

    expect(mockPublish).toHaveBeenCalledTimes(1);
    const [topic, msg] = mockPublish.mock.calls[0];
    expect(topic).toBe(COMMANDS.pensionerCreate);
    expect(msg.payload.ppoNo).toBe("PPO-P1");
    // Money fields are bigint on the wire → stringified for the queue payload.
    expect(msg.payload.basicPensionMinor).toBe("4500000");
    expect(typeof msg.payload.basicPensionMinor).toBe("string");
    expect(result.status).toBe("accepted");
    expect(result.id).toBeTruthy();
  });
});

describe("Pensioner CQRS — consumer persistence", () => {
  it("pensionerCreate inserts via the payrollPensioners Drizzle table (PII-encrypted columns) and fires pensionerCreated", async () => {
    const { registerPayrollConsumers } = await import("../src/modules/payroll/consumer.js");
    const { COMMANDS, EVENTS } = await import("../src/topics.js");
    const { payrollPensioners } = await import("../src/modules/payroll/schema.js");

    const handlers: Record<string, (msg: unknown) => Promise<void>> = {};
    const q = { subscribe: (t: string, fn: (msg: unknown) => Promise<void>) => { handlers[t] = fn; } } as any;
    registerPayrollConsumers(q);

    await handlers[COMMANDS.pensionerCreate]({
      ...baseMsg, messageId: "m-pen-1",
      payload: {
        id: "pen-1", tenantId: TENANT, ppoNo: "PPO-P2", fullName: "Consumer Test",
        dateOfBirth: "1958-03-20", basicPensionMinor: "4500000", commutationDate: null,
        ddoCode: null, bankAccountNo: null, bankIfsc: null, pan: null, taxRegime: "old",
      },
    });

    expect(insertedTables).toHaveLength(1);
    expect(insertedTables[0]).toBe(payrollPensioners);
    const values = insertedValues[0] as Record<string, unknown>;
    expect(values.ppoNo).toBe("PPO-P2");
    // basicPensionMinor is parsed back to a bigint from the wire string.
    expect(values.basicPensionMinor).toBe(4500000n);

    // The consumer also enqueues an audit.event.record row alongside the
    // domain event — assert the domain event fired, not an exact count.
    expect(mockEnqueued.some((e) => e.topic === EVENTS.pensionerCreated)).toBe(true);
  });

  it("is idempotent on redelivery (markProcessed returns false → no insert, no event)", async () => {
    mockMarkResult = false;
    const { registerPayrollConsumers } = await import("../src/modules/payroll/consumer.js");
    const { COMMANDS } = await import("../src/topics.js");

    const handlers: Record<string, (msg: unknown) => Promise<void>> = {};
    const q = { subscribe: (t: string, fn: (msg: unknown) => Promise<void>) => { handlers[t] = fn; } } as any;
    registerPayrollConsumers(q);

    await handlers[COMMANDS.pensionerCreate]({
      ...baseMsg, messageId: "m-pen-dup",
      payload: {
        id: "pen-dup", tenantId: TENANT, ppoNo: "PPO-DUP", fullName: "Dup",
        dateOfBirth: "1958-03-20", basicPensionMinor: "100", commutationDate: null,
        ddoCode: null, bankAccountNo: null, bankIfsc: null, pan: null, taxRegime: "new",
      },
    });

    expect(insertedTables).toHaveLength(0);
    expect(mockEnqueued).toHaveLength(0);
  });
});
