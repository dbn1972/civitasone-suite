/**
 * GET /v1/hrms/transfers, /promotions, /deputation — optional ?employeeId=
 * filter regression test — real-DB round-trip (EMPLOYEES-DETAIL-01).
 *
 * SEC/correctness finding: the employee-detail page's lifecycle deep links
 * pass ?employeeId= expecting to see just that one employee's history, but
 * these three routes parsed no query params at all and always returned the
 * WHOLE tenant's rows regardless — silently ignoring the filter they were
 * given. This file's own sibling GET /v1/hrms/service-book already
 * supported this correctly; the fix mirrors it exactly. HR_ROLES-only
 * access is unchanged — this is a filter-application fix, not a role or
 * scoping change.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT    = "facade00-0f1b-4000-8000-000000000f1b";
const SEED_ACTOR = "facade00-0f1b-4000-8000-0000000000ff";
const DEPT_ID    = "facade00-0f1b-4000-8000-0000000000d1";
const DESIG_ID   = "facade00-0f1b-4000-8000-0000000000d2";

const EMP1_ID = "facade00-0f1b-4000-8000-0000000000e1";
const EMP2_ID = "facade00-0f1b-4000-8000-0000000000e2";

const hrToken = signToken({ sub: "lifecycle-filter-hr-f1b", tid: TENANT, roles: ["hr_admin"], sid: "sess-lifecycle-filter-test" }, SECRET);

let app: Awaited<ReturnType<typeof buildApp>>;

function asTenant<T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, TENANT, fn);
}

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM lifecycle.hrms_transfers WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM lifecycle.hrms_promotions WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM lifecycle.hrms_deputations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

beforeAll(async () => {
  await cleanup();

  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DEPT_ID}, ${TENANT}, 'LCFLT', 'Lifecycle Filter Test Dept', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DESIG_ID}, ${TENANT}, 'LCFLT', 'Lifecycle Filter Test Designation', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  for (const [id, empNo, name] of [
    [EMP1_ID, "LCFLT-001", "Lifecycle Filter Emp One"],
    [EMP2_ID, "LCFLT-002", "Lifecycle Filter Emp Two"],
  ] as const) {
    await asTenant((tx) => tx`
      INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by)
      VALUES (${id}, ${TENANT}, ${empNo}, ${name}, ${DEPT_ID}, ${DESIG_ID}, '2020-01-01', ${SEED_ACTOR}, ${SEED_ACTOR})
    `);
  }

  for (const empId of [EMP1_ID, EMP2_ID]) {
    await asTenant((tx) => tx`
      INSERT INTO lifecycle.hrms_transfers (id, tenant_id, employee_id, from_dept_id, to_dept_id, effective_date, created_by, updated_by)
      VALUES (gen_random_uuid(), ${TENANT}, ${empId}, ${DEPT_ID}, ${DEPT_ID}, '2026-11-01', ${SEED_ACTOR}, ${SEED_ACTOR})
    `);
    await asTenant((tx) => tx`
      INSERT INTO lifecycle.hrms_promotions (id, tenant_id, employee_id, from_desig_id, to_desig_id, effective_date, created_by, updated_by)
      VALUES (gen_random_uuid(), ${TENANT}, ${empId}, ${DESIG_ID}, ${DESIG_ID}, '2026-11-01', ${SEED_ACTOR}, ${SEED_ACTOR})
    `);
    await asTenant((tx) => tx`
      INSERT INTO lifecycle.hrms_deputations
        (id, tenant_id, employee_id, parent_cadre, parent_department_id, borrowing_department, tenure_from, tenure_to, created_by, updated_by)
      VALUES (gen_random_uuid(), ${TENANT}, ${empId}, 'Parent Cadre', ${DEPT_ID}, 'Borrowing Dept', '2026-01-01', '2026-06-01', ${SEED_ACTOR}, ${SEED_ACTOR})
    `);
  }

  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe.each([
  ["/v1/hrms/transfers"],
  ["/v1/hrms/promotions"],
  ["/v1/hrms/deputation"],
])("GET %s — employeeId filter (EMPLOYEES-DETAIL-01)", (base) => {
  it("no employeeId: returns both employees' rows (unchanged)", async () => {
    const r = await app.inject({ method: "GET", url: base, headers: { authorization: `Bearer ${hrToken}` } });
    expect(r.statusCode).toBe(200);
    const rows = JSON.parse(r.body).data as Array<{ employee: string }>;
    expect(rows.map((x) => x.employee).sort()).toEqual(["Lifecycle Filter Emp One", "Lifecycle Filter Emp Two"].sort());
  });

  it("?employeeId=<emp1>: scopes to just that employee — previously ignored, returned everyone regardless", async () => {
    const r = await app.inject({ method: "GET", url: `${base}?employeeId=${EMP1_ID}`, headers: { authorization: `Bearer ${hrToken}` } });
    expect(r.statusCode).toBe(200);
    const rows = JSON.parse(r.body).data as Array<{ employee: string }>;
    expect(rows.map((x) => x.employee)).toEqual(["Lifecycle Filter Emp One"]);
  });
});
