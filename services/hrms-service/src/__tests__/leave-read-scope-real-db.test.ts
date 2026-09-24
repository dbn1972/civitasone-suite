/**
 * Leave read-scope regression test — real-DB round-trip.
 *
 * SEC finding (HRMS role-based review): GET /v1/hrms/leave-allocations had
 * ZERO employee scoping at all (`WHERE tenant_id=$1 LIMIT 50` — any
 * ALL_ROLES-holding caller, including a bare "employee", got every
 * allocation in the tenant). GET /v1/hrms/leave-applications and
 * GET /v1/hrms/leave/applications took their `empId` query param raw, with
 * no ownership check — an employee could read anyone's leave applications
 * just by passing their uuid, and omitting `empId` entirely fell through to
 * the same unscoped tenant-wide list.
 *
 * Scoping decision — mirrors leave/routes.ts's OWN pre-existing write-side
 * ownership guard (enforceCcsLeaveRules) and cancel-route.ts's identical
 * guard, both already reviewed/tested in this codebase:
 *   - HR roles: full tenant access (unchanged).
 *   - "manager": scoped to DIRECT REPORTS ONLY (hrmsEmployees.managerId),
 *     never the full reporting subtree, and never including themselves —
 *     "my team" = direct reports, not self, matching the identical
 *     precedent in manager-employee-read-scope-real-db.test.ts.
 *   - bare "employee": scoped to their own linked hrms_employees record
 *     (resolveEmployeeForActor — userRef primary, email fallback), the
 *     same resolution self-service/routes.ts and leave/routes.ts's own
 *     write-side guard already use.
 *
 * Fail-closed edge cases: an actor whose hrms_employees link cannot be
 * resolved at all (self-service or manager) must see NOTHING (empty list),
 * never fall back to unscoped tenant-wide access — same convention
 * manager-employee-read-scope-real-db.test.ts already established for
 * GET /v1/hrms/employees.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT        = "facade00-0800-4000-8000-000000000800";
const SEED_ACTOR     = "facade00-0800-4000-8000-000000000099"; // created_by/updated_by filler
const DEPT_ID        = "facade00-0800-4000-8000-0000000000d1";
const DESIG_ID       = "facade00-0800-4000-8000-0000000000d2";
const LEAVE_TYPE_ID  = "facade00-0800-4000-8000-0000000000ca";

const MANAGER_ID  = "facade00-0800-4000-8000-0000000000e1";
const REPORT1_ID  = "facade00-0800-4000-8000-0000000000e2";
const REPORT2_ID  = "facade00-0800-4000-8000-0000000000e3";
const OUTSIDER_ID = "facade00-0800-4000-8000-0000000000e4"; // same tenant, NOT a report

const MANAGER_ALLOC  = "facade00-0800-4000-8000-0000000000a1";
const REPORT1_ALLOC  = "facade00-0800-4000-8000-0000000000a2";
const REPORT2_ALLOC  = "facade00-0800-4000-8000-0000000000a3";
const OUTSIDER_ALLOC = "facade00-0800-4000-8000-0000000000a4";

const MANAGER_APP  = "facade00-0800-4000-8000-0000000000b1";
const REPORT1_APP  = "facade00-0800-4000-8000-0000000000b2";
const REPORT2_APP  = "facade00-0800-4000-8000-0000000000b3";
const OUTSIDER_APP = "facade00-0800-4000-8000-0000000000b4";

// JWT `sub` -> ctx.actorId, matched against hrms_employees.user_ref by
// resolveEmployeeForActor. This column is NOT a uuid FK (see
// manager-employee-read-scope-real-db.test.ts's identical convention), so a
// human-readable label is fine — these read routes never write actorId into
// a uuid-typed column.
const MANAGER_SUB          = "leave-scope-mgr-800";
const REPORT1_SUB          = "leave-scope-report1-800";
const UNLINKED_MGR_SUB     = "leave-scope-unlinked-mgr-800";
const UNLINKED_EMP_SUB     = "leave-scope-unlinked-emp-800";
const HR_SUB                = "leave-scope-hr-800";

function tok(roles: string[], sub: string) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-leave-scope-test" }, SECRET);
}
const managerToken     = tok(["manager"], MANAGER_SUB);
const report1Token     = tok(["employee"], REPORT1_SUB);
const unlinkedMgrToken = tok(["manager"], UNLINKED_MGR_SUB);
const unlinkedEmpToken = tok(["employee"], UNLINKED_EMP_SUB);
const hrToken           = tok(["hr_admin"], HR_SUB);

let app: Awaited<ReturnType<typeof buildApp>>;

// employee.hrms_employees / leave.hrms_leave_allocs / leave.hrms_leave_apps
// are RLS ENABLE+FORCEd — this test's own seed/verification queries need the
// same app.tenant_id GUC the routes set via scopedRead. Reuses the exact
// convention manager-employee-read-scope-real-db.test.ts and
// hrms-claims-schema-real-db.test.ts already established.
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

  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DEPT_ID}, ${TENANT}, 'LVSCOPE', 'Leave Scope Test Dept', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DESIG_ID}, ${TENANT}, 'LVSCOPE', 'Leave Scope Test Designation', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  // The manager — linked to managerToken's JWT `sub` via user_ref.
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, user_ref, created_by, updated_by)
    VALUES
      (${MANAGER_ID}, ${TENANT}, 'LVSCOPE-001', 'Leave Scope Manager', ${DEPT_ID}, ${DESIG_ID}, '2020-01-01', ${MANAGER_SUB}, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  // Two direct reports (manager_id = MANAGER_ID). REPORT1 is ALSO linked to
  // report1Token's `sub`, so the same row doubles as "a manager's direct
  // report" AND "a bare employee viewing their own record".
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, manager_id, user_ref, created_by, updated_by)
    VALUES
      (${REPORT1_ID}, ${TENANT}, 'LVSCOPE-002', 'Leave Scope Report One', ${DEPT_ID}, ${DESIG_ID}, '2021-01-01', ${MANAGER_ID}, ${REPORT1_SUB}, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, manager_id, created_by, updated_by)
    VALUES
      (${REPORT2_ID}, ${TENANT}, 'LVSCOPE-003', 'Leave Scope Report Two', ${DEPT_ID}, ${DESIG_ID}, '2021-06-01', ${MANAGER_ID}, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  // Exists in the SAME tenant, but does not report to MANAGER_ID and is not
  // linked to any test token — the "exists but not yours/not a report" case.
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by)
    VALUES
      (${OUTSIDER_ID}, ${TENANT}, 'LVSCOPE-004', 'Leave Scope Outsider', ${DEPT_ID}, ${DESIG_ID}, '2019-01-01', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  await asTenant((tx) => tx`
    INSERT INTO leave.hrms_leave_types (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${LEAVE_TYPE_ID}, ${TENANT}, 'LVSCOPE', 'Leave Scope Test Type', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  // One allocation per employee, so each can be identified by employeeId in
  // the /leave-allocations response.
  for (const [allocId, empId] of [
    [MANAGER_ALLOC, MANAGER_ID],
    [REPORT1_ALLOC, REPORT1_ID],
    [REPORT2_ALLOC, REPORT2_ID],
    [OUTSIDER_ALLOC, OUTSIDER_ID],
  ] as const) {
    await asTenant((tx) => tx`
      INSERT INTO leave.hrms_leave_allocs (id, tenant_id, employee_id, leave_type_id, fy, total_days, balance_days, created_by, updated_by)
      VALUES (${allocId}, ${TENANT}, ${empId}, ${LEAVE_TYPE_ID}, '2026-27', 12, 12, ${SEED_ACTOR}, ${SEED_ACTOR})
    `);
  }

  // One application per employee, each debiting that employee's own
  // allocation, so each can be identified by id in the
  // /leave-applications and /leave/applications responses.
  for (const [appId, empId, allocId] of [
    [MANAGER_APP, MANAGER_ID, MANAGER_ALLOC],
    [REPORT1_APP, REPORT1_ID, REPORT1_ALLOC],
    [REPORT2_APP, REPORT2_ID, REPORT2_ALLOC],
    [OUTSIDER_APP, OUTSIDER_ID, OUTSIDER_ALLOC],
  ] as const) {
    await asTenant((tx) => tx`
      INSERT INTO leave.hrms_leave_apps (id, tenant_id, employee_id, leave_type_id, alloc_id, from_date, to_date, days_applied, status, created_by, updated_by)
      VALUES (${appId}, ${TENANT}, ${empId}, ${LEAVE_TYPE_ID}, ${allocId}, '2026-10-01', '2026-10-01', 1, 'pending', ${SEED_ACTOR}, ${SEED_ACTOR})
    `);
  }

  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/leave-allocations — read scope", () => {
  it("self-service employee: sees ONLY their own allocation", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/leave-allocations",
      headers: { authorization: `Bearer ${report1Token}` },
    });
    expect(r.statusCode).toBe(200);
    const ids = (JSON.parse(r.body).data as Array<{ employeeId: string }>).map((a) => a.employeeId);
    expect(ids).toEqual([REPORT1_ID]);
  });

  it("self-service employee with NO resolvable employee link fails CLOSED to an empty list", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/leave-allocations",
      headers: { authorization: `Bearer ${unlinkedEmpToken}` },
    });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).data).toEqual([]);
  });

  it("manager-only token: sees exactly their direct reports' allocations — not their own, not an outsider's", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/leave-allocations",
      headers: { authorization: `Bearer ${managerToken}` },
    });
    expect(r.statusCode).toBe(200);
    const ids = (JSON.parse(r.body).data as Array<{ employeeId: string }>).map((a) => a.employeeId);
    expect(ids.sort()).toEqual([REPORT1_ID, REPORT2_ID].sort());
    expect(ids).not.toContain(MANAGER_ID);  // "my team" = direct reports, not self
    expect(ids).not.toContain(OUTSIDER_ID);
  });

  it("manager-only token with NO resolvable employee link fails CLOSED to an empty list", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/leave-allocations",
      headers: { authorization: `Bearer ${unlinkedMgrToken}` },
    });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).data).toEqual([]);
  });

  it("HR admin: full tenant-wide access is preserved (unchanged)", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/leave-allocations",
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(r.statusCode).toBe(200);
    const ids = (JSON.parse(r.body).data as Array<{ employeeId: string }>).map((a) => a.employeeId);
    expect(ids).toEqual(expect.arrayContaining([MANAGER_ID, REPORT1_ID, REPORT2_ID, OUTSIDER_ID]));
  });
});

describe("GET /v1/hrms/leave/applications — read scope", () => {
  it("self-service employee, no empId: sees only their own application", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/leave/applications",
      headers: { authorization: `Bearer ${report1Token}` },
    });
    expect(r.statusCode).toBe(200);
    const ids = (JSON.parse(r.body).data as Array<{ id: string }>).map((a) => a.id);
    expect(ids).toEqual([REPORT1_APP]);
  });

  it("self-service employee requesting another employee's empId is redirected to their own (IDOR closed)", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/leave/applications?empId=${OUTSIDER_ID}`,
      headers: { authorization: `Bearer ${report1Token}` },
    });
    expect(r.statusCode).toBe(200);
    const ids = (JSON.parse(r.body).data as Array<{ id: string }>).map((a) => a.id);
    expect(ids).toEqual([REPORT1_APP]);
    expect(ids).not.toContain(OUTSIDER_APP);
  });

  it("manager, no empId: sees their direct reports' applications, not their own, not an outsider's", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/leave/applications",
      headers: { authorization: `Bearer ${managerToken}` },
    });
    expect(r.statusCode).toBe(200);
    const ids = (JSON.parse(r.body).data as Array<{ id: string }>).map((a) => a.id);
    expect(ids.sort()).toEqual([REPORT1_APP, REPORT2_APP].sort());
    expect(ids).not.toContain(MANAGER_APP);
    expect(ids).not.toContain(OUTSIDER_APP);
  });

  it("manager targeting a real direct report's empId: scoped to just that report", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/leave/applications?empId=${REPORT1_ID}`,
      headers: { authorization: `Bearer ${managerToken}` },
    });
    expect(r.statusCode).toBe(200);
    const ids = (JSON.parse(r.body).data as Array<{ id: string }>).map((a) => a.id);
    expect(ids).toEqual([REPORT1_APP]);
  });

  it("manager targeting a NON-report's empId falls back to their own team, never the outsider's application (IDOR closed)", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/leave/applications?empId=${OUTSIDER_ID}`,
      headers: { authorization: `Bearer ${managerToken}` },
    });
    expect(r.statusCode).toBe(200);
    const ids = (JSON.parse(r.body).data as Array<{ id: string }>).map((a) => a.id);
    expect(ids).not.toContain(OUTSIDER_APP);
    expect(ids.sort()).toEqual([REPORT1_APP, REPORT2_APP].sort());
  });

  it("HR targeting a specific empId: unaffected (unchanged single-target passthrough)", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/leave/applications?empId=${OUTSIDER_ID}`,
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(r.statusCode).toBe(200);
    const ids = (JSON.parse(r.body).data as Array<{ id: string }>).map((a) => a.id);
    expect(ids).toEqual([OUTSIDER_APP]);
  });

  it("HR with no empId: full tenant-wide access is preserved (unchanged)", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/leave/applications?limit=50",
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(r.statusCode).toBe(200);
    const ids = (JSON.parse(r.body).data as Array<{ id: string }>).map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining([MANAGER_APP, REPORT1_APP, REPORT2_APP, OUTSIDER_APP]));
  });
});

describe("GET /v1/hrms/leave-applications — read scope", () => {
  it("self-service employee, no empId: sees only their own application", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/leave-applications",
      headers: { authorization: `Bearer ${report1Token}` },
    });
    expect(r.statusCode).toBe(200);
    const ids = (JSON.parse(r.body).data as Array<{ id: string }>).map((a) => a.id);
    expect(ids).toEqual([REPORT1_APP]);
  });

  it("self-service employee requesting another employee's empId is redirected to their own (IDOR closed)", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/leave-applications?empId=${OUTSIDER_ID}`,
      headers: { authorization: `Bearer ${report1Token}` },
    });
    expect(r.statusCode).toBe(200);
    const ids = (JSON.parse(r.body).data as Array<{ id: string }>).map((a) => a.id);
    expect(ids).toEqual([REPORT1_APP]);
    expect(ids).not.toContain(OUTSIDER_APP);
  });

  it("manager, no empId: sees their direct reports' applications only", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/leave-applications",
      headers: { authorization: `Bearer ${managerToken}` },
    });
    expect(r.statusCode).toBe(200);
    const ids = (JSON.parse(r.body).data as Array<{ id: string }>).map((a) => a.id);
    expect(ids.sort()).toEqual([REPORT1_APP, REPORT2_APP].sort());
    expect(ids).not.toContain(MANAGER_APP);
    expect(ids).not.toContain(OUTSIDER_APP);
  });

  it("manager targeting a NON-report's empId falls back to their own team (IDOR closed)", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/leave-applications?empId=${OUTSIDER_ID}`,
      headers: { authorization: `Bearer ${managerToken}` },
    });
    expect(r.statusCode).toBe(200);
    const ids = (JSON.parse(r.body).data as Array<{ id: string }>).map((a) => a.id);
    expect(ids).not.toContain(OUTSIDER_APP);
    expect(ids.sort()).toEqual([REPORT1_APP, REPORT2_APP].sort());
  });

  it("HR targeting a specific empId: unaffected (unchanged single-target passthrough)", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/leave-applications?empId=${OUTSIDER_ID}`,
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(r.statusCode).toBe(200);
    const ids = (JSON.parse(r.body).data as Array<{ id: string }>).map((a) => a.id);
    expect(ids).toEqual([OUTSIDER_APP]);
  });

  it("HR with no empId: full tenant-wide access is preserved (unchanged)", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/leave-applications?limit=50",
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(r.statusCode).toBe(200);
    const ids = (JSON.parse(r.body).data as Array<{ id: string }>).map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining([MANAGER_APP, REPORT1_APP, REPORT2_APP, OUTSIDER_APP]));
  });
});
