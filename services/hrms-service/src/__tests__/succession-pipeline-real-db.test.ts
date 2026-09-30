/**
 * Succession pipeline/risk regression test — real-DB round-trip
 * (GAP-HR-SUCCESSION-01/02/03).
 *
 * Before this fix: GET /v1/hrms/succession/pipeline returned only
 * aggregate counts (nominee_count, ready_now) and a raw department_id, so
 * the web page fabricated placeholder "Nominee N" people and printed the
 * department's UUID. GET /v1/hrms/succession/risk had no is_critical
 * filter parity with the risk register's own logic being duplicated
 * client-side, and readiness values ("now"/"1yr"/"2yr"/"3yr") were never
 * mapped to the UI's three-band model server-side.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT     = "facade00-0f1c-4000-8000-000000000f1c";
const SEED_ACTOR = "facade00-0f1c-4000-8000-0000000000ff";
const DEPT_ID    = "facade00-0f1c-4000-8000-0000000000d1";
const DESIG_ID   = "facade00-0f1c-4000-8000-0000000000d2";

const EMP_READY_ID  = "facade00-0f1c-4000-8000-0000000000e1"; // readiness "now"
const EMP_LATER_ID  = "facade00-0f1c-4000-8000-0000000000e2"; // readiness "2yr"
const EMP_FAR_ID    = "facade00-0f1c-4000-8000-0000000000e3"; // readiness "3yr"

const READY_PLAN_ID = "facade00-0f1c-4000-8000-0000000000a1"; // has a "now" nominee -> not at risk
const RISK_PLAN_ID  = "facade00-0f1c-4000-8000-0000000000a2"; // no "now" nominee -> at risk

const HR_SUB = "succ-pipeline-hr-f1c";
function tok(roles: string[], sub: string) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-succ-pipeline-test" }, SECRET);
}
const hrToken = tok(["hr_admin"], HR_SUB);

let app: Awaited<ReturnType<typeof buildApp>>;

function asTenant<T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, TENANT, fn);
}

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM employee.succession_nominees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.succession_plans WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

beforeAll(async () => {
  await cleanup();

  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DEPT_ID}, ${TENANT}, 'SUCCPIPE', 'Succession Pipeline Test Dept', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DESIG_ID}, ${TENANT}, 'SUCCPIPE', 'Succession Pipeline Test Designation', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  for (const [id, no, name] of [
    [EMP_READY_ID, "SUCCPIPE-001", "Succession Pipeline Ready Nominee"],
    [EMP_LATER_ID, "SUCCPIPE-002", "Succession Pipeline Later Nominee"],
    [EMP_FAR_ID, "SUCCPIPE-003", "Succession Pipeline Far Nominee"],
  ] as const) {
    await asTenant((tx) => tx`
      INSERT INTO employee.hrms_employees
        (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by)
      VALUES (${id}, ${TENANT}, ${no}, ${name}, ${DEPT_ID}, ${DESIG_ID}, '2020-01-01', ${SEED_ACTOR}, ${SEED_ACTOR})
    `);
  }

  // Plan with one "now" nominee -- must NOT show up in the at-risk register.
  await asTenant((tx) => tx`
    INSERT INTO employee.succession_plans (id, tenant_id, role_ref, department_id, is_critical, created_by)
    VALUES (${READY_PLAN_ID}, ${TENANT}, 'Chief Test Officer', ${DEPT_ID}, true, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.succession_nominees (id, tenant_id, plan_id, employee_id, readiness, development_plan)
    VALUES (gen_random_uuid(), ${TENANT}, ${READY_PLAN_ID}, ${EMP_READY_ID}, 'now', 'Shadowing the incumbent')
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.succession_nominees (id, tenant_id, plan_id, employee_id, readiness, development_plan)
    VALUES (gen_random_uuid(), ${TENANT}, ${READY_PLAN_ID}, ${EMP_LATER_ID}, '2yr', NULL)
  `);

  // Plan with only a far-out nominee -- must show up in the at-risk register.
  await asTenant((tx) => tx`
    INSERT INTO employee.succession_plans (id, tenant_id, role_ref, department_id, is_critical, created_by)
    VALUES (${RISK_PLAN_ID}, ${TENANT}, 'Deputy Test Officer', ${DEPT_ID}, true, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.succession_nominees (id, tenant_id, plan_id, employee_id, readiness, development_plan)
    VALUES (gen_random_uuid(), ${TENANT}, ${RISK_PLAN_ID}, ${EMP_FAR_ID}, '3yr', NULL)
  `);

  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/succession/pipeline (GAP-HR-SUCCESSION-01/02/03)", () => {
  it("returns the real department name, not the raw UUID", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/succession/pipeline",
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(r.statusCode).toBe(200);
    const rows = JSON.parse(r.body).data as Array<{ role_ref: string; department: string }>;
    const readyRole = rows.find((x) => x.role_ref === "Chief Test Officer");
    expect(readyRole?.department).toBe("Succession Pipeline Test Dept");
  });

  it("returns real per-nominee successors with names and mapped readiness bands (2yr -> one_two_years)", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/succession/pipeline",
      headers: { authorization: `Bearer ${hrToken}` },
    });
    const rows = JSON.parse(r.body).data as Array<{
      role_ref: string; riskLevel: string;
      successors: Array<{ employeeId: string; name: string; readiness: string }>;
    }>;
    const readyRole = rows.find((x) => x.role_ref === "Chief Test Officer");
    expect(readyRole?.successors).toHaveLength(2);
    const byId = Object.fromEntries((readyRole?.successors ?? []).map((s) => [s.employeeId, s]));
    expect(byId[EMP_READY_ID]).toMatchObject({ name: "Succession Pipeline Ready Nominee", readiness: "ready_now" });
    expect(byId[EMP_LATER_ID]).toMatchObject({ name: "Succession Pipeline Later Nominee", readiness: "one_two_years" });
    // No fabricated "Nominee N" placeholder names anywhere.
    expect((readyRole?.successors ?? []).some((s) => /^Nominee \d+$/.test(s.name))).toBe(false);
  });

  it("computes riskLevel from real readiness counts (1 ready now -> medium, 0 ready now -> high)", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/succession/pipeline",
      headers: { authorization: `Bearer ${hrToken}` },
    });
    const rows = JSON.parse(r.body).data as Array<{ role_ref: string; riskLevel: string }>;
    expect(rows.find((x) => x.role_ref === "Chief Test Officer")?.riskLevel).toBe("medium");
    expect(rows.find((x) => x.role_ref === "Deputy Test Officer")?.riskLevel).toBe("high");
  });
});

describe("GET /v1/hrms/succession/risk (GAP-HR-SUCCESSION-02)", () => {
  it("lists only the role with zero ready-now nominees, with a real department name", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/succession/risk",
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(r.statusCode).toBe(200);
    const rows = JSON.parse(r.body).data as Array<{ role_ref: string; department: string }>;
    expect(rows.map((x) => x.role_ref)).toContain("Deputy Test Officer");
    expect(rows.map((x) => x.role_ref)).not.toContain("Chief Test Officer");
    expect(rows.find((x) => x.role_ref === "Deputy Test Officer")?.department).toBe("Succession Pipeline Test Dept");
  });
});
