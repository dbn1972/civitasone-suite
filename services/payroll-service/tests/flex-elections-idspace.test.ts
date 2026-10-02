/**
 * Flex-benefit elections stored in the wrong id space (follow-up to the
 * payroll self-service ownership id-space fix).
 *
 * The flexElectionUpsert consumer stored employee_id = msg.actorId (the
 * elector's LOGIN user id) and GET /flex-benefits/my-elections filtered on
 * ctx.actorId. The two agreed, so nothing leaked, but payroll lookups by
 * hrms employee id never matched those rows. Now:
 *  - the route resolves the caller's hrms employee id before enqueueing and
 *    the consumer stores payload.employeeId;
 *  - my-elections filters on the resolved id (502 HRMS down, 403 unlinked);
 *  - flex-election-backfill.ts repairs pre-existing rows, per tenant, with a
 *    dry run, fail-closed on HRMS, idempotent, conflict/unlinked-safe.
 *
 * hrms-client is mocked: JWT subjects resolve to DIFFERENT employee ids, and
 * only for TENANT (a tenant-aware resolver).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";

const H = vi.hoisted(() => ({ hrmsDown: false, tenant: "", map: {} as Record<string, string> }));

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return {
    ...actual,
    resolveActorEmployeeId: vi.fn(async (tenantId: string, actorId: string) => {
      if (H.hrmsDown) throw new actual.HrmsUnavailableError("hrms down (test)");
      return tenantId === H.tenant ? (H.map[actorId] ?? null) : null;
    }),
  };
});

const { backfillFlexElectionEmployeeIds } = await import("../src/modules/payroll/flex-election-backfill.js");
const { registerPayrollConsumers } = await import("../src/modules/payroll/consumer.js");
const { COMMANDS } = await import("../src/topics.js");
const { HrmsUnavailableError } = await import("../src/shared/hrms-client.js");

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const TENANT_B = randomUUID();
const OPERATOR = randomUUID();
// JWT subjects (login user ids) ...
const EMP_ACTOR = randomUUID();
const CONFLICT_ACTOR = randomUUID();
const UNLINKED_ACTOR = randomUUID();
// ... and the hrms employee ids they resolve to.
const EMP_OWN = randomUUID();
const CONFLICT_EMP = randomUUID();

const PLAN_A = randomUUID();
const PLAN_B = randomUUID();
const PLAN_TENANT_B = randomUUID();
const FY = "2026-27";
const R_LEGACY = randomUUID();     // employee_id = EMP_ACTOR (login id) -> remap to EMP_OWN
const R_CONFLICT = randomUUID();   // employee_id = CONFLICT_ACTOR, but CONFLICT_EMP already has PLAN_B/FY
const R_CORRECT = randomUUID();    // employee_id = CONFLICT_EMP (already right)
const R_UNLINKED = randomUUID();   // employee_id = UNLINKED_ACTOR, hrms has no employee
const R_OTHER_TENANT = randomUUID(); // TENANT_B row shaped like R_LEGACY: must never be touched

H.tenant = TENANT;
H.map = { [EMP_ACTOR]: EMP_OWN, [CONFLICT_ACTOR]: CONFLICT_EMP };

function auth(sub: string, roles: string[]) {
  return { authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "flex-idspace" }, SECRET)}` };
}

async function call(method: "GET" | "POST", url: string, headers: Record<string, string>, payload?: unknown) {
  const app = await buildApp();
  try {
    return await app.inject({ method, url, headers, payload: payload as never });
  } finally {
    await app.close();
  }
}

async function employeeIdOf(tenantId: string, id: string): Promise<string | undefined> {
  const rows = await runWithTenant(tenantId, () => db.transaction(async (tx) =>
    (await tx.execute(sql`SELECT employee_id::text AS e FROM payroll.flex_benefit_elections WHERE id = ${id}::uuid`)) as unknown as Array<{ e: string }>));
  return rows[0]?.e;
}

async function insertElection(tenantId: string, id: string, employeeId: string, createdBy: string, planId: string) {
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO payroll.flex_benefit_elections (id, tenant_id, employee_id, plan_id, fy, elections, total_elected_minor, created_by)
      VALUES (${id}::uuid, ${tenantId}::uuid, ${employeeId}::uuid, ${planId}::uuid, ${FY},
        ${JSON.stringify([{ component: "Medical", electedMinor: 100000 }])}::jsonb, 100000, ${createdBy}::uuid)
    `);
  }));
}

beforeAll(async () => {
  for (const [t, plans] of [[TENANT, [PLAN_A, PLAN_B]], [TENANT_B, [PLAN_TENANT_B]]] as const) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      for (const [i, planId] of plans.entries()) {
        await tx.execute(sql`
          INSERT INTO payroll.flex_benefit_plans (id, tenant_id, name, fy, total_budget_minor, components, created_by)
          VALUES (${planId}::uuid, ${t}::uuid, ${`Flex ${i}`}, ${FY}, 5000000,
            ${JSON.stringify([{ name: "Medical", maxMinor: 2000000, taxExempt: true }])}::jsonb, ${OPERATOR}::uuid)
        `);
      }
    }));
  }
  await insertElection(TENANT, R_LEGACY, EMP_ACTOR, EMP_ACTOR, PLAN_A);
  await insertElection(TENANT, R_CONFLICT, CONFLICT_ACTOR, CONFLICT_ACTOR, PLAN_B);
  await insertElection(TENANT, R_CORRECT, CONFLICT_EMP, CONFLICT_ACTOR, PLAN_B);
  await insertElection(TENANT, R_UNLINKED, UNLINKED_ACTOR, UNLINKED_ACTOR, PLAN_A);
  await insertElection(TENANT_B, R_OTHER_TENANT, EMP_ACTOR, EMP_ACTOR, PLAN_TENANT_B);
});

afterAll(async () => {
  for (const t of [TENANT, TENANT_B]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM payroll.flex_benefit_elections WHERE tenant_id = ${t}::uuid`);
      await tx.execute(sql`DELETE FROM payroll.flex_benefit_plans WHERE tenant_id = ${t}::uuid`);
    }));
  }
  await sqlClient.end();
});

beforeEach(() => { H.hrmsDown = false; });

// Ordered: the backfill block mutates the seeded rows the later blocks read.
describe("flex-election-backfill (per tenant, dry run, fail closed, idempotent)", () => {
  it("dry run reports remap / conflict / unlinked and writes nothing", async () => {
    const r = await backfillFlexElectionEmployeeIds({ tenantId: TENANT });
    expect(r.apply).toBe(false);
    const byId = Object.fromEntries(r.rows.map((x) => [x.id, x]));
    expect(byId[R_LEGACY]).toMatchObject({ outcome: "would_remap", fromEmployeeId: EMP_ACTOR, toEmployeeId: EMP_OWN });
    expect(byId[R_CONFLICT]).toMatchObject({ outcome: "conflict", toEmployeeId: CONFLICT_EMP });
    expect(byId[R_UNLINKED]).toMatchObject({ outcome: "unlinked", toEmployeeId: null });
    expect(byId[R_CORRECT]).toBeUndefined();
    expect(byId[R_OTHER_TENANT]).toBeUndefined();
    expect(r.remapped).toBe(0);
    expect(await employeeIdOf(TENANT, R_LEGACY)).toBe(EMP_ACTOR);
  });

  it("HRMS unreachable -> throws before any write", async () => {
    H.hrmsDown = true;
    await expect(backfillFlexElectionEmployeeIds({ tenantId: TENANT, apply: true, actorId: OPERATOR }))
      .rejects.toBeInstanceOf(HrmsUnavailableError);
    expect(await employeeIdOf(TENANT, R_LEGACY)).toBe(EMP_ACTOR);
  });

  it("apply requires an operator actor id and a UUID tenant", async () => {
    await expect(backfillFlexElectionEmployeeIds({ tenantId: TENANT, apply: true })).rejects.toThrow(/actorId/);
    await expect(backfillFlexElectionEmployeeIds({ tenantId: "not-a-uuid" })).rejects.toThrow(/tenantId/);
  });

  it("apply migrates wrong-id-space rows, leaves conflicts/unlinked and other tenants untouched, and audits", async () => {
    const r = await backfillFlexElectionEmployeeIds({ tenantId: TENANT, apply: true, actorId: OPERATOR });
    expect(r).toMatchObject({ remapped: 1, conflicts: 1, unlinked: 1 });
    expect(await employeeIdOf(TENANT, R_LEGACY)).toBe(EMP_OWN);
    expect(await employeeIdOf(TENANT, R_CONFLICT)).toBe(CONFLICT_ACTOR);
    expect(await employeeIdOf(TENANT, R_CORRECT)).toBe(CONFLICT_EMP);
    expect(await employeeIdOf(TENANT, R_UNLINKED)).toBe(UNLINKED_ACTOR);
    expect(await employeeIdOf(TENANT_B, R_OTHER_TENANT)).toBe(EMP_ACTOR);
    const audits = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      (await tx.execute(sql`
        SELECT actor_id::text AS actor, payload FROM _outbox.messages
        WHERE tenant_id = ${TENANT}::uuid AND topic = 'audit.event.record'
          AND payload->>'resourceType' = 'payroll_flex_election'
      `)) as unknown as Array<{ actor: string; payload: Record<string, unknown> }>));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actor).toBe(OPERATOR);
    expect(audits[0]!.payload).toMatchObject({
      action: "backfill_employee_id", resourceId: R_LEGACY, fromEmployeeId: EMP_ACTOR, toEmployeeId: EMP_OWN,
    });
  });

  it("is idempotent: a second apply changes nothing", async () => {
    const r = await backfillFlexElectionEmployeeIds({ tenantId: TENANT, apply: true, actorId: OPERATOR });
    expect(r.remapped).toBe(0);
    expect(r.rows.some((x) => x.id === R_LEGACY)).toBe(false);
    expect(await employeeIdOf(TENANT, R_LEGACY)).toBe(EMP_OWN);
  });
});

describe("GET /v1/payroll/flex-benefits/my-elections", () => {
  it("an employee sees their OWN elections (stored under their hrms employee id)", async () => {
    const res = await call("GET", "/v1/payroll/flex-benefits/my-elections", auth(EMP_ACTOR, ["employee"]));
    expect(res.statusCode, res.body).toBe(200);
    const ids = (res.json().data as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toEqual([R_LEGACY]);
  });

  it("HRMS unreachable -> 502", async () => {
    H.hrmsDown = true;
    const res = await call("GET", "/v1/payroll/flex-benefits/my-elections", auth(EMP_ACTOR, ["employee"]));
    expect(res.statusCode).toBe(502);
  });

  it("an unlinked user -> 403", async () => {
    const res = await call("GET", "/v1/payroll/flex-benefits/my-elections", auth(UNLINKED_ACTOR, ["employee"]));
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/payroll/flex-benefits/elections", () => {
  const payload = { planId: PLAN_B, fy: FY, elections: [{ component: "Medical", electedMinor: 150000 }] };

  it("enqueues the election under the caller's resolved hrms employee id", async () => {
    const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    try {
      const res = await call("POST", "/v1/payroll/flex-benefits/elections", auth(EMP_ACTOR, ["employee"]), payload);
      expect(res.statusCode, res.body).toBe(202);
      const call0 = spy.mock.calls.find(([topic]) => topic === COMMANDS.flexElectionUpsert);
      expect(call0).toBeDefined();
      expect((call0![1] as { payload: { employeeId: string } }).payload.employeeId).toBe(EMP_OWN);
    } finally {
      spy.mockRestore();
    }
  });

  it("a body naming another employee still enqueues the caller's OWN resolved id", async () => {
    const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    try {
      const res = await call("POST", "/v1/payroll/flex-benefits/elections", auth(EMP_ACTOR, ["employee"]),
        { ...payload, employeeId: CONFLICT_EMP });
      expect(res.statusCode, res.body).toBe(202);
      const sent = spy.mock.calls.find(([topic]) => topic === COMMANDS.flexElectionUpsert);
      expect((sent![1] as { schemaVersion: string; payload: { employeeId: string } }).payload.employeeId).toBe(EMP_OWN);
      expect((sent![1] as { schemaVersion: string }).schemaVersion).toBe("1.1");
    } finally {
      spy.mockRestore();
    }
  });

  it("HRMS unreachable -> 502, nothing enqueued", async () => {
    H.hrmsDown = true;
    const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    try {
      const res = await call("POST", "/v1/payroll/flex-benefits/elections", auth(EMP_ACTOR, ["employee"]), payload);
      expect(res.statusCode).toBe(502);
      expect(spy.mock.calls.some(([topic]) => topic === COMMANDS.flexElectionUpsert)).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("flexElectionUpsert consumer", () => {
  const handlers = new Map<string, (msg: unknown) => Promise<void>>();
  beforeAll(() => {
    const fakeQueue = {
      subscribe: (topic: string, h: (msg: unknown) => Promise<void>) => { handlers.set(topic, h); },
      publish: async () => undefined, start: async () => undefined, stop: async () => undefined,
    };
    registerPayrollConsumers(fakeQueue as never);
  });

  const msg = (id: string, payloadEmployeeId: string | undefined, schemaVersion = "1.1") => ({
    messageId: id, type: COMMANDS.flexElectionUpsert, tenantId: TENANT, actorId: EMP_ACTOR,
    correlationId: randomUUID(), schemaVersion,
    payload: {
      id, tenantId: TENANT, planId: PLAN_B, fy: FY, totalElectedMinor: 150000,
      elections: [{ component: "Medical", electedMinor: 150000 }],
      ...(payloadEmployeeId ? { employeeId: payloadEmployeeId } : {}),
    },
  });

  it("stores payload.employeeId (the hrms employee id), not the actor's login id", async () => {
    const id = randomUUID();
    await handlers.get(COMMANDS.flexElectionUpsert)!(msg(id, EMP_OWN));
    expect(await employeeIdOf(TENANT, id)).toBe(EMP_OWN);
  });

  it("a legacy 1.0 message without employeeId falls back to the actor id (backfill repairs it)", async () => {
    const id = randomUUID();
    await handlers.get(COMMANDS.flexElectionUpsert)!({ ...msg(id, undefined, "1.0"), payload: { ...msg(id, undefined).payload, planId: PLAN_A } });
    expect(await employeeIdOf(TENANT, id)).toBe(EMP_ACTOR);
  });

  it("a 1.1 message without employeeId is rejected (non-retryable) and writes nothing", async () => {
    const { NonRetryableError } = await import("@civitasone/queue");
    const id = randomUUID();
    await expect(handlers.get(COMMANDS.flexElectionUpsert)!(msg(id, undefined, "1.1"))).rejects.toBeInstanceOf(NonRetryableError);
    expect(await employeeIdOf(TENANT, id)).toBeUndefined();
  });
});
