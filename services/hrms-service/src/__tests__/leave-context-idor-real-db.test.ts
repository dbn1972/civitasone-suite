/**
 * GET /v1/hrms/leave-context IDOR regression test — real-DB round-trip.
 *
 * SEC finding (GAP-HR-SF-16 fold-in: LEAVE-02/LEAVE-APPLY-02/LEAVE-BALANCE-01):
 * `employeeId` was a REQUIRED query param checked only for role membership
 * (ALL_ROLES = everyone) — any authenticated caller could pass ANY
 * employeeId and get that employee's leave types + balances. Fixed with a
 * direct ownership check (self, or for a manager, a direct report), NOT
 * resolveLeaveReadScope's list-of-ids shape — this is a single-target
 * lookup, and critically a manager viewing their OWN leave-context must
 * keep working (see the "manager: self-access" case below) — a manager is
 * still an employee with their own leave to check, unlike the
 * team-review-shaped list endpoints where resolveLeaveReadScope
 * deliberately excludes self.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT       = "facade00-0f17-4000-8000-000000000f17";
const SEED_ACTOR    = "facade00-0f17-4000-8000-0000000000ff";
const DEPT_ID       = "facade00-0f17-4000-8000-0000000000d1";
const DESIG_ID      = "facade00-0f17-4000-8000-0000000000d2";
const LEAVE_TYPE_ID = "facade00-0f17-4000-8000-0000000000ca";

const MANAGER_ID  = "facade00-0f17-4000-8000-0000000000e1";
const REPORT1_ID  = "facade00-0f17-4000-8000-0000000000e2";
const OUTSIDER_ID = "facade00-0f17-4000-8000-0000000000e4"; // same tenant, NOT a report

const MANAGER_SUB = "leave-context-mgr-f17";
const REPORT1_SUB = "leave-context-report1-f17";
const HR_SUB      = "leave-context-hr-f17";

function tok(roles: string[], sub: string) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-leave-context-test" }, SECRET);
}
const managerToken = tok(["manager"], MANAGER_SUB);
const report1Token = tok(["employee"], REPORT1_SUB);
const hrToken      = tok(["hr_admin"], HR_SUB);

let app: Awaited<ReturnType<typeof buildApp>>;

function asTenant<T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, TENANT, fn);
}

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM leave.hrms_leave_allocs WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM leave.hrms_leave_types WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

beforeAll(async () => {
  await cleanup();

  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DEPT_ID}, ${TENANT}, 'LVCTX', 'Leave Context Test Dept', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DESIG_ID}, ${TENANT}, 'LVCTX', 'Leave Context Test Designation', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, user_ref, created_by, updated_by)
    VALUES
      (${MANAGER_ID}, ${TENANT}, 'LVCTX-001', 'Leave Ctx Manager', ${DEPT_ID}, ${DESIG_ID}, '2020-01-01', ${MANAGER_SUB}, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, manager_id, user_ref, created_by, updated_by)
    VALUES
      (${REPORT1_ID}, ${TENANT}, 'LVCTX-002', 'Leave Ctx Report One', ${DEPT_ID}, ${DESIG_ID}, '2021-01-01', ${MANAGER_ID}, ${REPORT1_SUB}, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by)
    VALUES
      (${OUTSIDER_ID}, ${TENANT}, 'LVCTX-003', 'Leave Ctx Outsider', ${DEPT_ID}, ${DESIG_ID}, '2019-01-01', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  await asTenant((tx) => tx`
    INSERT INTO leave.hrms_leave_types (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${LEAVE_TYPE_ID}, ${TENANT}, 'LVCTX', 'Leave Ctx Test Type', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  for (const empId of [MANAGER_ID, REPORT1_ID, OUTSIDER_ID]) {
    await asTenant((tx) => tx`
      INSERT INTO leave.hrms_leave_allocs (id, tenant_id, employee_id, leave_type_id, fy, total_days, balance_days, created_by, updated_by)
      VALUES (gen_random_uuid(), ${TENANT}, ${empId}, ${LEAVE_TYPE_ID}, '2026-27', 12, 12, ${SEED_ACTOR}, ${SEED_ACTOR})
    `);
  }

  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/leave-context — ownership check (GAP-HR-SF-16 item 3)", () => {
  it("bare employee viewing their OWN context: 200 with their own allocations", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/leave-context?employeeId=${REPORT1_ID}`,
      headers: { authorization: `Bearer ${report1Token}` },
    });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).employee.id).toBe(REPORT1_ID);
  });

  it("bare employee viewing ANOTHER employee's context: 403 (IDOR closed)", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/leave-context?employeeId=${OUTSIDER_ID}`,
      headers: { authorization: `Bearer ${report1Token}` },
    });
    expect(r.statusCode).toBe(403);
  });

  it("manager viewing a direct report's context: 200", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/leave-context?employeeId=${REPORT1_ID}`,
      headers: { authorization: `Bearer ${managerToken}` },
    });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).employee.id).toBe(REPORT1_ID);
  });

  it("manager viewing an OUTSIDER's context (not a direct report): 403 (IDOR closed)", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/leave-context?employeeId=${OUTSIDER_ID}`,
      headers: { authorization: `Bearer ${managerToken}` },
    });
    expect(r.statusCode).toBe(403);
  });

  it("manager viewing their OWN context: 200 — must NOT be locked out of their own leave data by the fix", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/leave-context?employeeId=${MANAGER_ID}`,
      headers: { authorization: `Bearer ${managerToken}` },
    });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).employee.id).toBe(MANAGER_ID);
  });

  it("HR viewing any employee's context: 200 (unrestricted, unchanged)", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/leave-context?employeeId=${OUTSIDER_ID}`,
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).employee.id).toBe(OUTSIDER_ID);
  });

  it("unknown employeeId still 404s (unchanged, checked before the ownership gate)", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/leave-context?employeeId=00000000-0000-4000-8000-000000000000`,
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(r.statusCode).toBe(404);
  });
});
