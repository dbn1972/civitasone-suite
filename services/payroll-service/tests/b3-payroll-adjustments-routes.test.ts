/**
 * b3 payroll-adjustments gap batch -- route-level regression tests against a
 * real (disposable) Postgres, through buildApp():
 *
 *  - GAP-PAYROLL-FLEX-BENEFITS-01/03: GET /flex-benefits/plans exists; an
 *    election is validated against its plan (components, caps, budget, FY).
 *  - GAP-PAYROLL-OFF-CYCLE-02/04: list carries employee_count; process needs
 *    a reason, is draft-only and maker-checker guarded.
 *  - GAP-PAYROLL-REIMBURSEMENTS-01/02/04/05: self-service list/create use the
 *    caller's resolved hrms employee id; approve/reject endpoints with
 *    maker-checker; period must be a real month.
 *  - GAP-PAYROLL-BONUS-03: bonusPct 8.33..20 and a consecutive-year FY.
 *
 * hrms-client is mocked (no hrms-service in this isolated env): existence
 * checks pass, and resolveActorEmployeeId maps JWT subjects to DIFFERENT
 * employee ids -- the whole point of the REIMBURSEMENTS-01 fix.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();

// JWT subjects (actor ids) ...
const MAKER = randomUUID();
const CHECKER = randomUUID();
const EMP_ACTOR = randomUUID();
const CLAIMANT_ACTOR = randomUUID();
const FIN_EMP_ACTOR = randomUUID();
// ... and the hrms employee ids they resolve to (a different id space).
const EMP_OWN_ID = randomUUID();
const CLAIMANT_EMP_ID = randomUUID();
const OTHER_EMP_ID = randomUUID();

const ACTOR_TO_EMPLOYEE: Record<string, string> = {
  [EMP_ACTOR]: EMP_OWN_ID,
  [CLAIMANT_ACTOR]: CLAIMANT_EMP_ID,
  [FIN_EMP_ACTOR]: EMP_OWN_ID,
};

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return {
    ...actual,
    verifyEmployeeExists: vi.fn(async () => true),
    resolveActorEmployeeId: vi.fn(async (_tenant: string, actorId: string) => ACTOR_TO_EMPLOYEE[actorId] ?? null),
  };
});

const PLAN_ID = randomUUID();
const DRAFT_RUN_ID = randomUUID();
const PROCESSED_RUN_ID = randomUUID();
const CLAIM_SUBMITTED = randomUUID();
const CLAIM_APPROVED = randomUUID();
const CLAIM_OWN = randomUUID();
const CLAIM_REJECT = randomUUID();

function auth(sub: string, roles: string[]) {
  return { authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "b3-adj" }, SECRET)}` };
}
const payroll = (sub = CHECKER) => auth(sub, ["payroll_admin"]);
const employee = (sub = EMP_ACTOR) => auth(sub, ["employee"]);

async function inject(opts: { method: "GET" | "POST" | "PATCH"; url: string; headers: Record<string, string>; payload?: unknown }) {
  const app = await buildApp();
  try {
    return await app.inject(opts as Parameters<typeof app.inject>[0]);
  } finally {
    await app.close();
  }
}

beforeAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO payroll.flex_benefit_plans (id, tenant_id, name, fy, total_budget_minor, components, created_by)
        VALUES (${PLAN_ID}::uuid, ${TENANT}::uuid, 'Standard Flex', '2026-27', 5000000,
          ${JSON.stringify([{ name: "Medical", maxMinor: 2000000, taxExempt: true }, { name: "LTA", maxMinor: 3000000, taxExempt: true }])}::jsonb,
          ${MAKER}::uuid)
      `);
      for (const [id, status] of [[DRAFT_RUN_ID, "draft"], [PROCESSED_RUN_ID, "processed"]] as const) {
        await tx.execute(sql`
          INSERT INTO payroll.off_cycle_runs (id, tenant_id, run_type, period, total_amount_minor, status, created_by)
          VALUES (${id}::uuid, ${TENANT}::uuid, 'bonus', '2026-09', 100000, ${status}, ${MAKER}::uuid)
        `);
        await tx.execute(sql`
          INSERT INTO payroll.off_cycle_items (tenant_id, off_cycle_run_id, employee_id, amount_minor)
          VALUES (${TENANT}::uuid, ${id}::uuid, ${OTHER_EMP_ID}::uuid, 100000)
        `);
      }
      const claims: Array<[string, string, string]> = [
        [CLAIM_SUBMITTED, CLAIMANT_EMP_ID, "submitted"],
        [CLAIM_REJECT, CLAIMANT_EMP_ID, "submitted"],
        [CLAIM_APPROVED, CLAIMANT_EMP_ID, "approved"],
        [CLAIM_OWN, EMP_OWN_ID, "submitted"],
      ];
      for (const [id, emp, status] of claims) {
        await tx.execute(sql`
          INSERT INTO payroll.payroll_reimbursements (id, tenant_id, employee_id, category, amount_minor, period, status, created_by)
          VALUES (${id}::uuid, ${TENANT}::uuid, ${emp}::uuid, 'medical', 150000, '2026-08', ${status}, ${MAKER}::uuid)
        `);
      }
    }),
  );
});

afterAll(async () => {
  await sqlClient.end();
});

describe("GAP-PAYROLL-FLEX-BENEFITS-01: GET /v1/payroll/flex-benefits/plans", () => {
  it("lists the tenant's active plans with components and budget, for an employee", async () => {
    const res = await inject({ method: "GET", url: "/v1/payroll/flex-benefits/plans", headers: employee() });
    expect(res.statusCode).toBe(200);
    const plan = (res.json().data as Array<Record<string, unknown>>).find((p) => p.id === PLAN_ID);
    expect(plan).toBeDefined();
    expect(Number(plan!.total_budget_minor)).toBe(5000000);
    expect(plan!.components).toEqual([
      { name: "Medical", maxMinor: 2000000, taxExempt: true },
      { name: "LTA", maxMinor: 3000000, taxExempt: true },
    ]);
  });

  it("filters by fy", async () => {
    const res = await inject({ method: "GET", url: "/v1/payroll/flex-benefits/plans?fy=2025-26", headers: employee() });
    expect(res.statusCode).toBe(200);
    expect((res.json().data as Array<{ id: string }>).some((p) => p.id === PLAN_ID)).toBe(false);
  });

  it("403 for a citizen", async () => {
    const res = await inject({ method: "GET", url: "/v1/payroll/flex-benefits/plans", headers: auth(MAKER, ["citizen"]) });
    expect(res.statusCode).toBe(403);
  });
});

describe("GAP-PAYROLL-FLEX-BENEFITS-01/03: election validated against its plan", () => {
  const elect = (payload: unknown) =>
    inject({ method: "POST", url: "/v1/payroll/flex-benefits/elections", headers: employee(), payload });

  it("202 for an election inside the plan's caps and budget", async () => {
    const res = await elect({ planId: PLAN_ID, fy: "2026-27", elections: [{ component: "Medical", electedMinor: 1500000 }, { component: "LTA", electedMinor: 3000000 }] });
    expect(res.statusCode).toBe(202);
  });

  it("404 for an unknown plan", async () => {
    const res = await elect({ planId: randomUUID(), fy: "2026-27", elections: [{ component: "Medical", electedMinor: 1 }] });
    expect(res.statusCode).toBe(404);
  });

  it.each([
    ["a component not in the plan", { planId: PLAN_ID, fy: "2026-27", elections: [{ component: "Fuel", electedMinor: 100 }] }],
    ["an amount above the component max", { planId: PLAN_ID, fy: "2026-27", elections: [{ component: "Medical", electedMinor: 2000001 }] }],
    ["a duplicated component", { planId: PLAN_ID, fy: "2026-27", elections: [{ component: "LTA", electedMinor: 10 }, { component: "LTA", electedMinor: 10 }] }],
    ["a FY different from the plan's", { planId: PLAN_ID, fy: "2025-26", elections: [{ component: "Medical", electedMinor: 100 }] }],
  ])("400 for %s", async (_label, payload) => {
    const res = await elect(payload);
    expect(res.statusCode).toBe(400);
  });

  it("400 when the total exceeds the plan budget", async () => {
    // Medical 2,000,000 + LTA 3,000,000 = 5,000,000 is exactly the budget;
    // a plan whose caps sum above its budget is the only way to exceed it.
    const overPlan = randomUUID();
    await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.execute(sql`
        INSERT INTO payroll.flex_benefit_plans (id, tenant_id, name, fy, total_budget_minor, components, created_by)
        VALUES (${overPlan}::uuid, ${TENANT}::uuid, 'Tight Flex', '2026-27', 1000,
          ${JSON.stringify([{ name: "A", maxMinor: 800 }, { name: "B", maxMinor: 800 }])}::jsonb, ${MAKER}::uuid)
      `)),
    );
    const res = await elect({ planId: overPlan, fy: "2026-27", elections: [{ component: "A", electedMinor: 800 }, { component: "B", electedMinor: 300 }] });
    expect(res.statusCode).toBe(400);
  });
});

describe("GAP-PAYROLL-OFF-CYCLE-02/04: off-cycle list + process guards", () => {
  it("GET /v1/payroll/off-cycle returns employee_count per run", async () => {
    const res = await inject({ method: "GET", url: "/v1/payroll/off-cycle", headers: payroll() });
    expect(res.statusCode).toBe(200);
    const run = (res.json().data as Array<{ id: string; employee_count: number }>).find((r) => r.id === DRAFT_RUN_ID);
    expect(run?.employee_count).toBe(1);
  });

  it("403 SELF_APPROVAL_FORBIDDEN when the creator processes their own run", async () => {
    const res = await inject({ method: "POST", url: `/v1/payroll/off-cycle/${DRAFT_RUN_ID}/process`, headers: payroll(MAKER), payload: { reason: "Quarterly incentive payout approved" } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("SELF_APPROVAL_FORBIDDEN");
  });

  it("400 when no reason (or a too-short one) is given", async () => {
    const none = await inject({ method: "POST", url: `/v1/payroll/off-cycle/${DRAFT_RUN_ID}/process`, headers: payroll() });
    expect(none.statusCode).toBe(400);
    const short = await inject({ method: "POST", url: `/v1/payroll/off-cycle/${DRAFT_RUN_ID}/process`, headers: payroll(), payload: { reason: "ok" } });
    expect(short.statusCode).toBe(400);
  });

  it("409 for a run that is no longer draft", async () => {
    const res = await inject({ method: "POST", url: `/v1/payroll/off-cycle/${PROCESSED_RUN_ID}/process`, headers: payroll(), payload: { reason: "Quarterly incentive payout approved" } });
    expect(res.statusCode).toBe(409);
  });

  it("202 for a different payroll user with a reason", async () => {
    const res = await inject({ method: "POST", url: `/v1/payroll/off-cycle/${DRAFT_RUN_ID}/process`, headers: payroll(CHECKER), payload: { reason: "Quarterly incentive payout approved" } });
    expect(res.statusCode).toBe(202);
  });
});

describe("GAP-PAYROLL-REIMBURSEMENTS-05: self-service list is scoped to the caller", () => {
  it("an employee sees only their own claims (not a 403, not the tenant list)", async () => {
    const res = await inject({ method: "GET", url: "/v1/payroll/reimbursements", headers: employee() });
    expect(res.statusCode).toBe(200);
    const ids = (res.json().data as Array<{ id: string; employee_id: string }>).map((r) => r.employee_id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids)).toEqual(new Set([EMP_OWN_ID]));
  });

  it("an employee naming someone else's employeeId gets 403", async () => {
    const res = await inject({ method: "GET", url: `/v1/payroll/reimbursements?employeeId=${CLAIMANT_EMP_ID}`, headers: employee() });
    expect(res.statusCode).toBe(403);
  });

  // b3 review (HIGH): finance_officer is "privileged" in shared/context.ts
  // but is NOT one of this route's ROLES -- a finance_officer+employee user
  // must be scoped like any employee, not handed the whole tenant's claims.
  it("a finance_officer+employee caller sees only their own claims", async () => {
    const res = await inject({ method: "GET", url: "/v1/payroll/reimbursements", headers: auth(FIN_EMP_ACTOR, ["finance_officer", "employee"]) });
    expect(res.statusCode).toBe(200);
    const emps = new Set((res.json().data as Array<{ employee_id: string }>).map((r) => r.employee_id));
    expect(emps).toEqual(new Set([EMP_OWN_ID]));
  });

  it("a finance_officer+employee caller naming another employee gets 403 (list and create)", async () => {
    const headers = auth(FIN_EMP_ACTOR, ["finance_officer", "employee"]);
    const list = await inject({ method: "GET", url: `/v1/payroll/reimbursements?employeeId=${CLAIMANT_EMP_ID}`, headers });
    expect(list.statusCode).toBe(403);
    const create = await inject({ method: "POST", url: "/v1/payroll/reimbursements", headers, payload: { employeeId: CLAIMANT_EMP_ID, category: "food", amountMinor: 1000, period: "2026-08" } });
    expect(create.statusCode).toBe(403);
  });

  it("payroll staff still see the tenant list", async () => {
    const res = await inject({ method: "GET", url: "/v1/payroll/reimbursements", headers: payroll() });
    expect(res.statusCode).toBe(200);
    const emps = new Set((res.json().data as Array<{ employee_id: string }>).map((r) => r.employee_id));
    expect(emps.has(EMP_OWN_ID) && emps.has(CLAIMANT_EMP_ID)).toBe(true);
  });
});

describe("GAP-PAYROLL-REIMBURSEMENTS-01/04: self-service create uses the resolved employee id", () => {
  const claim = (employeeId: string, period = "2026-08") => ({ employeeId, category: "food", amountMinor: 150000, period });

  it("202 when an employee files for their own employee id", async () => {
    const res = await inject({ method: "POST", url: "/v1/payroll/reimbursements", headers: employee(), payload: claim(EMP_OWN_ID) });
    expect(res.statusCode).toBe(202);
  });

  it("403 when an employee sends their JWT subject (actor id) instead -- a different id space", async () => {
    const res = await inject({ method: "POST", url: "/v1/payroll/reimbursements", headers: employee(), payload: claim(EMP_ACTOR) });
    expect(res.statusCode).toBe(403);
  });

  it("403 when an employee files in a co-worker's name", async () => {
    const res = await inject({ method: "POST", url: "/v1/payroll/reimbursements", headers: employee(), payload: claim(CLAIMANT_EMP_ID) });
    expect(res.statusCode).toBe(403);
  });

  it("400 for a period that is not a calendar month", async () => {
    const res = await inject({ method: "POST", url: "/v1/payroll/reimbursements", headers: payroll(), payload: claim(OTHER_EMP_ID, "2026-13") });
    expect(res.statusCode).toBe(400);
  });
});

describe("GAP-PAYROLL-REIMBURSEMENTS-02: approve / reject", () => {
  const approve = (id: string, headers: Record<string, string>, payload?: unknown) =>
    inject({ method: "PATCH", url: `/v1/payroll/reimbursements/${id}/approve`, headers, payload });
  const reject = (id: string, headers: Record<string, string>, payload?: unknown) =>
    inject({ method: "PATCH", url: `/v1/payroll/reimbursements/${id}/reject`, headers, payload });

  it("403 for an employee", async () => {
    expect((await approve(CLAIM_SUBMITTED, employee())).statusCode).toBe(403);
  });

  it("403 for the person who filed the claim (maker-checker)", async () => {
    const res = await approve(CLAIM_SUBMITTED, payroll(MAKER));
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("SELF_APPROVAL_FORBIDDEN");
  });

  it("403 for the claimant themselves, even with a payroll role", async () => {
    const res = await approve(CLAIM_SUBMITTED, auth(CLAIMANT_ACTOR, ["payroll_officer"]));
    expect(res.statusCode).toBe(403);
  });

  it("404 for an unknown claim, 409 for one that is not submitted", async () => {
    expect((await approve(randomUUID(), payroll())).statusCode).toBe(404);
    expect((await approve(CLAIM_APPROVED, payroll())).statusCode).toBe(409);
  });

  it("202 for an independent approver", async () => {
    expect((await approve(CLAIM_SUBMITTED, payroll())).statusCode).toBe(202);
  });

  it("reject requires a reason of at least 10 characters", async () => {
    expect((await reject(CLAIM_REJECT, payroll())).statusCode).toBe(400);
    expect((await reject(CLAIM_REJECT, payroll(), { reason: "no" })).statusCode).toBe(400);
    expect((await reject(CLAIM_REJECT, payroll(), { reason: "Bill does not match the claimed amount" })).statusCode).toBe(202);
  });
});

describe("GAP-PAYROLL-BONUS-03: bonus compute bounds", () => {
  const compute = (payload: unknown) => inject({ method: "POST", url: "/v1/payroll/bonus/compute", headers: payroll(), payload });
  const base = { employeeId: OTHER_EMP_ID, fy: "2026-27", basicMinor: 2100000 };

  it.each([[8.32], [20.01], [8.333]])("400 for bonusPct %s", async (bonusPct) => {
    expect((await compute({ ...base, bonusPct })).statusCode).toBe(400);
  });

  it("400 for a non-consecutive FY", async () => {
    expect((await compute({ ...base, fy: "2026-28", bonusPct: 8.33 })).statusCode).toBe(400);
  });

  it.each([[8.33], [20]])("202 for bonusPct %s", async (bonusPct) => {
    expect((await compute({ ...base, bonusPct })).statusCode).toBe(202);
  });
});
