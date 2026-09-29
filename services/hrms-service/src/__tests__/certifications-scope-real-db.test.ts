/**
 * GET /v1/hrms/certifications read-scope regression test — real-DB
 * round-trip (CERTIFICATIONS-02, GAP-HR-SF-16 priority-queue fold-in).
 *
 * SEC finding: this route had NO employee scoping at all — any
 * READER_ROLES-holding caller (HR, manager, or a bare "employee") got every
 * employee's completed training certifications tenant-wide. This route had
 * no existing scope precedent of its own to preserve (unlike this file's
 * OTHER routes' resolveOwnEmployeeIdIfBareEmployee, which deliberately
 * treats "manager" as privileged — a convention this fix does not touch),
 * so the fresh scope check targets the campaign's stated model: HR
 * unrestricted, manager scoped to self + direct reports, bare employee
 * scoped to self.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT       = "facade00-0f1a-4000-8000-000000000f1a";
const SEED_ACTOR    = "facade00-0f1a-4000-8000-0000000000ff";
const DEPT_ID       = "facade00-0f1a-4000-8000-0000000000d1";
const DESIG_ID      = "facade00-0f1a-4000-8000-0000000000d2";
const TRAINING_ID   = "facade00-0f1a-4000-8000-0000000000c7";

const MANAGER_ID  = "facade00-0f1a-4000-8000-0000000000e1";
const REPORT1_ID  = "facade00-0f1a-4000-8000-0000000000e2";
const OUTSIDER_ID = "facade00-0f1a-4000-8000-0000000000e4"; // same tenant, NOT a report

const MANAGER_SUB = "certs-scope-mgr-f1a";
const REPORT1_SUB = "certs-scope-report1-f1a";
const HR_SUB      = "certs-scope-hr-f1a";

function tok(roles: string[], sub: string) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-certs-scope-test" }, SECRET);
}
const managerToken = tok(["manager"], MANAGER_SUB);
const report1Token = tok(["employee"], REPORT1_SUB);
const hrToken      = tok(["hr_admin"], HR_SUB);

let app: Awaited<ReturnType<typeof buildApp>>;

function asTenant<T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, TENANT, fn);
}

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM training.hrms_nominations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM training.hrms_trainings WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

beforeAll(async () => {
  await cleanup();

  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DEPT_ID}, ${TENANT}, 'CERTSC', 'Certifications Scope Test Dept', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DESIG_ID}, ${TENANT}, 'CERTSC', 'Certifications Scope Test Designation', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, user_ref, created_by, updated_by)
    VALUES (${MANAGER_ID}, ${TENANT}, 'CERTSC-001', 'Certs Scope Manager', ${DEPT_ID}, ${DESIG_ID}, '2020-01-01', ${MANAGER_SUB}, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, manager_id, user_ref, created_by, updated_by)
    VALUES (${REPORT1_ID}, ${TENANT}, 'CERTSC-002', 'Certs Scope Report One', ${DEPT_ID}, ${DESIG_ID}, '2021-01-01', ${MANAGER_ID}, ${REPORT1_SUB}, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by)
    VALUES (${OUTSIDER_ID}, ${TENANT}, 'CERTSC-003', 'Certs Scope Outsider', ${DEPT_ID}, ${DESIG_ID}, '2019-01-01', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  await asTenant((tx) => tx`
    INSERT INTO training.hrms_trainings (id, tenant_id, title, from_date, to_date, created_by, updated_by)
    VALUES (${TRAINING_ID}, ${TENANT}, 'Certs Scope Test Training', '2026-01-01', '2026-01-02', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  for (const empId of [MANAGER_ID, REPORT1_ID, OUTSIDER_ID]) {
    await asTenant((tx) => tx`
      INSERT INTO training.hrms_nominations (id, tenant_id, training_id, employee_id, status, certificate_ref, completed_date, created_by, updated_by)
      VALUES (gen_random_uuid(), ${TENANT}, ${TRAINING_ID}, ${empId}, 'completed', 'CERT-' || ${empId}, '2026-01-02', ${SEED_ACTOR}, ${SEED_ACTOR})
    `);
  }

  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/certifications — read scope (CERTIFICATIONS-02)", () => {
  it("bare employee: sees only their own certification", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/certifications",
      headers: { authorization: `Bearer ${report1Token}` },
    });
    expect(r.statusCode).toBe(200);
    const rows = JSON.parse(r.body).data as Array<{ employee: string }>;
    expect(rows.map((x) => x.employee)).toEqual(["Certs Scope Report One"]);
  });

  it("manager: sees self + direct reports only, never the outsider (closes the tenant-wide leak)", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/certifications",
      headers: { authorization: `Bearer ${managerToken}` },
    });
    expect(r.statusCode).toBe(200);
    const rows = JSON.parse(r.body).data as Array<{ employee: string }>;
    const names = rows.map((x) => x.employee).sort();
    expect(names).toEqual(["Certs Scope Manager", "Certs Scope Report One"].sort());
    expect(names).not.toContain("Certs Scope Outsider");
  });

  it("HR: full tenant-wide access preserved (unchanged)", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/certifications",
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(r.statusCode).toBe(200);
    const rows = JSON.parse(r.body).data as Array<{ employee: string }>;
    expect(rows.length).toBe(3);
  });
});
