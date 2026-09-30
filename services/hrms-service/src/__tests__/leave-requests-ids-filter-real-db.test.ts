/**
 * GAP-HR-LEAVE-APPROVALS-04 — real-DB round-trip regression test.
 *
 * GET /v1/hrms/leave-requests?ids=... narrows the response to exactly the
 * given application ids, as an ADDITIONAL filter on top of (never instead
 * of) the existing role-based scope — an id outside that scope is silently
 * dropped, never a way to see something the caller couldn't already.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "facade00-a504-4000-8000-000000000a54";
const SEED_ACTOR = "facade00-a504-4000-8000-0000000000ff";
const DEPT_ID = "facade00-a504-4000-8000-0000000000d1";
const DESIG_ID = "facade00-a504-4000-8000-0000000000d2";
const LEAVE_TYPE_ID = "facade00-a504-4000-8000-0000000000ca";

const MANAGER_ID = "facade00-a504-4000-8000-0000000000e1";
const REPORT_ID = "facade00-a504-4000-8000-0000000000e2";
const OUTSIDER_ID = "facade00-a504-4000-8000-0000000000e3"; // same tenant, NOT a report

const REPORT_ALLOC = "facade00-a504-4000-8000-0000000000a1";
const OUTSIDER_ALLOC = "facade00-a504-4000-8000-0000000000a2";
const REPORT_APP = "facade00-a504-4000-8000-0000000000b1";
const OUTSIDER_APP = "facade00-a504-4000-8000-0000000000b2";

function tok(roles: string[], sub: string) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-approvals-ids-test" }, SECRET);
}
const managerToken = tok(["manager"], MANAGER_ID);
const hrToken = tok(["hr_admin"], "facade00-a504-4000-8000-0000000000a9");

let app: Awaited<ReturnType<typeof buildApp>>;

function asTenant<T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, TENANT, fn);
}

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM leave.hrms_leave_apps WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM leave.hrms_leave_allocs WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM leave.hrms_leave_types WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

beforeAll(async () => {
  await cleanup();
  await asTenant((tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT_ID}, ${TENANT}, 'APIDS', 'Approvals Ids Test Dept', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by) VALUES (${DESIG_ID}, ${TENANT}, 'APIDS', 'Approvals Ids Test Designation', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, user_ref, created_by, updated_by) VALUES (${MANAGER_ID}, ${TENANT}, 'APIDS-001', 'Approvals Ids Manager', ${DEPT_ID}, ${DESIG_ID}, '2018-01-01', ${MANAGER_ID}, ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, manager_id, created_by, updated_by) VALUES (${REPORT_ID}, ${TENANT}, 'APIDS-002', 'Approvals Ids Report', ${DEPT_ID}, ${DESIG_ID}, '2019-01-01', ${MANAGER_ID}, ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by) VALUES (${OUTSIDER_ID}, ${TENANT}, 'APIDS-003', 'Approvals Ids Outsider', ${DEPT_ID}, ${DESIG_ID}, '2019-01-01', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`INSERT INTO leave.hrms_leave_types (id, tenant_id, code, name, created_by, updated_by) VALUES (${LEAVE_TYPE_ID}, ${TENANT}, 'APIDS', 'Approvals Ids Test Type', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  for (const [allocId, empId] of [[REPORT_ALLOC, REPORT_ID], [OUTSIDER_ALLOC, OUTSIDER_ID]] as const) {
    await asTenant((tx) => tx`INSERT INTO leave.hrms_leave_allocs (id, tenant_id, employee_id, leave_type_id, fy, total_days, balance_days, created_by, updated_by) VALUES (${allocId}, ${TENANT}, ${empId}, ${LEAVE_TYPE_ID}, '2026-27', 12, 12, ${SEED_ACTOR}, ${SEED_ACTOR})`);
  }
  for (const [appId, empId, allocId] of [[REPORT_APP, REPORT_ID, REPORT_ALLOC], [OUTSIDER_APP, OUTSIDER_ID, OUTSIDER_ALLOC]] as const) {
    await asTenant((tx) => tx`INSERT INTO leave.hrms_leave_apps (id, tenant_id, employee_id, leave_type_id, alloc_id, from_date, to_date, days_applied, status, created_by, updated_by) VALUES (${appId}, ${TENANT}, ${empId}, ${LEAVE_TYPE_ID}, ${allocId}, '2026-11-02', '2026-11-02', 1, 'pending', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  }
  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/leave-requests?ids= (GAP-HR-LEAVE-APPROVALS-04)", () => {
  it("HR: ids narrows to exactly the requested application(s), even when both exist in the tenant", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/leave-requests?ids=${REPORT_APP}`,
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(r.statusCode).toBe(200);
    const ids = (JSON.parse(r.body) as Array<{ id: string }>).map((a) => a.id);
    expect(ids).toEqual([REPORT_APP]);
  });

  it("manager: an id outside their own role-scope (an application NOT among their direct reports) is silently dropped, never returned just because it was named in ids", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/leave-requests?ids=${REPORT_APP},${OUTSIDER_APP}`,
      headers: { authorization: `Bearer ${managerToken}` },
    });
    expect(r.statusCode).toBe(200);
    const ids = (JSON.parse(r.body) as Array<{ id: string }>).map((a) => a.id);
    expect(ids).toEqual([REPORT_APP]);
    expect(ids).not.toContain(OUTSIDER_APP);
  });
});
