/**
 * POST /v1/hrms/benefits/elections — plan/cap validation (GAP2-HR-BENEFITS-07).
 *
 * Finding: the election-create route validated nothing about the plan it
 * elected into. It never confirmed the plan existed in the tenant, never
 * checked `fy` matched, never checked the component names were real plan
 * components, and never enforced the per-component `maxMinor` cap or the
 * plan-level `flex_budget_minor` budget. An employee could persist an
 * election that exceeded every cap, referenced a non-existent plan, or named
 * made-up components. These tests seed a real plan and assert the route now
 * rejects (404/422) and inserts nothing; the happy path still 201s.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const EMPLOYEE_ACTOR = randomUUID();
const FY = "2026-27";

function auth(sub: string, roles: string[]): { authorization: string } {
  return { authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "sess-benefits-cap" }, SECRET, 3600)}` };
}

let app: FastifyInstance;
let planId: string;

async function seedPlan(): Promise<string> {
  const id = randomUUID();
  const components = [
    { name: "hra", maxMinor: 5000000, taxExempt: true },  // cap ₹50,000
    { name: "ltc", maxMinor: 2000000, taxExempt: false }, // cap ₹20,000
  ];
  await withRawTenantGuc(sqlClient, TENANT, (tx) => tx`
    INSERT INTO employee.benefit_plans (id, tenant_id, name, fy, flex_budget_minor, components, created_by)
    VALUES (${id}, ${TENANT}, ${"Flexi Benefit " + id.slice(0, 6)}, ${FY}, ${6000000}, ${JSON.stringify(components)}::jsonb, ${EMPLOYEE_ACTOR})
  `);
  return id;
}

async function countElections(): Promise<number> {
  const rows = await withRawTenantGuc(sqlClient, TENANT, (tx) => tx`
    SELECT COUNT(*)::int AS n FROM employee.benefit_elections WHERE tenant_id = ${TENANT} AND employee_id = ${EMPLOYEE_ACTOR}
  `) as unknown as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

beforeAll(async () => {
  app = await buildApp();
  planId = await seedPlan();
});

afterAll(async () => {
  await withRawTenantGuc(sqlClient, TENANT, (tx) => tx`DELETE FROM employee.benefit_elections WHERE tenant_id = ${TENANT}`);
  await withRawTenantGuc(sqlClient, TENANT, (tx) => tx`DELETE FROM employee.benefit_plans WHERE tenant_id = ${TENANT}`);
  await app.close();
  await sqlClient.end();
});

describe("POST /v1/hrms/benefits/elections — plan & cap validation", () => {
  it("an election above a component's maxMinor cap is rejected (422) and inserts nothing", async () => {
    const before = await countElections();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/benefits/elections", headers: auth(EMPLOYEE_ACTOR, ["employee"]),
      payload: { planId, fy: FY, elections: [{ component: "hra", electedMinor: 9999999 }] }, // over ₹50,000 cap
    });
    expect(r.statusCode).toBe(422);
    expect(await countElections()).toBe(before);
  });

  it("a non-existent planId is rejected (404) and inserts nothing", async () => {
    const before = await countElections();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/benefits/elections", headers: auth(EMPLOYEE_ACTOR, ["employee"]),
      payload: { planId: randomUUID(), fy: FY, elections: [{ component: "hra", electedMinor: 100 }] },
    });
    expect(r.statusCode).toBe(404);
    expect(await countElections()).toBe(before);
  });

  it("a component name not in the plan is rejected (422)", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/benefits/elections", headers: auth(EMPLOYEE_ACTOR, ["employee"]),
      payload: { planId, fy: FY, elections: [{ component: "made_up", electedMinor: 100 }] },
    });
    expect(r.statusCode).toBe(422);
  });

  it("a summed total above flex_budget_minor is rejected (422)", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/benefits/elections", headers: auth(EMPLOYEE_ACTOR, ["employee"]),
      // 5,000,000 + 2,000,000 = 7,000,000 > 6,000,000 budget (each within its own cap)
      payload: { planId, fy: FY, elections: [{ component: "hra", electedMinor: 5000000 }, { component: "ltc", electedMinor: 2000000 }] },
    });
    expect(r.statusCode).toBe(422);
  });

  it("a fy that does not match the plan is rejected (422)", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/benefits/elections", headers: auth(EMPLOYEE_ACTOR, ["employee"]),
      payload: { planId, fy: "2099-00", elections: [{ component: "hra", electedMinor: 100 }] },
    });
    expect(r.statusCode).toBe(422);
  });

  it("a within-cap, within-budget election succeeds (201) and inserts a row", async () => {
    const before = await countElections();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/benefits/elections", headers: auth(EMPLOYEE_ACTOR, ["employee"]),
      payload: { planId, fy: FY, elections: [{ component: "hra", electedMinor: 4000000 }, { component: "ltc", electedMinor: 1000000 }] },
    });
    expect(r.statusCode).toBe(201);
    expect(await countElections()).toBe(before + 1);
  });
});
