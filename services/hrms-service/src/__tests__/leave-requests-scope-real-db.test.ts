/**
 * GET /v1/hrms/leave-requests read-scope regression test — real-DB round-trip.
 *
 * SEC finding (GAP-HR-SF-16, item 1): this route checked only
 * requireRole(ALL_ROLES) with NO employee scoping at all — any
 * ALL_ROLES-holding caller (HR, manager, or a bare "employee") got every
 * employee's leave request detail tenant-wide. Its siblings
 * /leave-applications and /leave-allocations already call
 * resolveLeaveReadScope; this fix reuses that exact helper/pattern here.
 *
 * Scoping contract (unchanged from the sibling routes, see
 * leave-read-scope-real-db.test.ts):
 *   - HR roles: full tenant access (unchanged).
 *   - "manager": scoped to DIRECT REPORTS ONLY, never themselves — "my
 *     team" = direct reports, not self (this route's real consumer is the
 *     approvals panel, reviewing OTHERS' requests; a manager's own leave
 *     history is served by GET /v1/hrms/me/leave-applications instead).
 *   - bare "employee": scoped to their own linked hrms_employees record.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT       = "facade00-0f16-4000-8000-000000000f16";
const SEED_ACTOR    = "facade00-0f16-4000-8000-0000000000ff";
const DEPT_ID       = "facade00-0f16-4000-8000-0000000000d1";
const DESIG_ID      = "facade00-0f16-4000-8000-0000000000d2";
const LEAVE_TYPE_ID = "facade00-0f16-4000-8000-0000000000ca";

const MANAGER_ID  = "facade00-0f16-4000-8000-0000000000e1";
const REPORT1_ID  = "facade00-0f16-4000-8000-0000000000e2";
const OUTSIDER_ID = "facade00-0f16-4000-8000-0000000000e4"; // same tenant, NOT a report

const MANAGER_ALLOC  = "facade00-0f16-4000-8000-0000000000a1";
const REPORT1_ALLOC  = "facade00-0f16-4000-8000-0000000000a2";
const OUTSIDER_ALLOC = "facade00-0f16-4000-8000-0000000000a4";

const MANAGER_APP  = "facade00-0f16-4000-8000-0000000000b1";
const REPORT1_APP  = "facade00-0f16-4000-8000-0000000000b2";
const OUTSIDER_APP = "facade00-0f16-4000-8000-0000000000b4";
// GAP-HR-LEAVE-03/04: two more requests for OUTSIDER with explicit,
// far-apart created_at values (set directly in the INSERT below, not left to
// wall-clock insertion order) to prove ORDER BY is real and deterministic —
// not an accident of insertion sequence.
const OLDER_APP = "facade00-0f16-4000-8000-0000000000b5";
const NEWER_APP = "facade00-0f16-4000-8000-0000000000b6";

const MANAGER_SUB      = "leave-requests-mgr-f16";
const REPORT1_SUB      = "leave-requests-report1-f16";
const UNLINKED_EMP_SUB = "leave-requests-unlinked-emp-f16";
const HR_SUB           = "leave-requests-hr-f16";

function tok(roles: string[], sub: string) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-leave-requests-test" }, SECRET);
}
const managerToken     = tok(["manager"], MANAGER_SUB);
const report1Token     = tok(["employee"], REPORT1_SUB);
const unlinkedEmpToken = tok(["employee"], UNLINKED_EMP_SUB);
const hrToken          = tok(["hr_admin"], HR_SUB);

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

  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DEPT_ID}, ${TENANT}, 'LVREQ', 'Leave Requests Test Dept', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DESIG_ID}, ${TENANT}, 'LVREQ', 'Leave Requests Test Designation', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, user_ref, created_by, updated_by)
    VALUES
      (${MANAGER_ID}, ${TENANT}, 'LVREQ-001', 'Leave Req Manager', ${DEPT_ID}, ${DESIG_ID}, '2020-01-01', ${MANAGER_SUB}, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, manager_id, user_ref, created_by, updated_by)
    VALUES
      (${REPORT1_ID}, ${TENANT}, 'LVREQ-002', 'Leave Req Report One', ${DEPT_ID}, ${DESIG_ID}, '2021-01-01', ${MANAGER_ID}, ${REPORT1_SUB}, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by)
    VALUES
      (${OUTSIDER_ID}, ${TENANT}, 'LVREQ-003', 'Leave Req Outsider', ${DEPT_ID}, ${DESIG_ID}, '2019-01-01', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  await asTenant((tx) => tx`
    INSERT INTO leave.hrms_leave_types (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${LEAVE_TYPE_ID}, ${TENANT}, 'LVREQ', 'Leave Req Test Type', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  for (const [allocId, empId] of [
    [MANAGER_ALLOC, MANAGER_ID],
    [REPORT1_ALLOC, REPORT1_ID],
    [OUTSIDER_ALLOC, OUTSIDER_ID],
  ] as const) {
    await asTenant((tx) => tx`
      INSERT INTO leave.hrms_leave_allocs (id, tenant_id, employee_id, leave_type_id, fy, total_days, balance_days, created_by, updated_by)
      VALUES (${allocId}, ${TENANT}, ${empId}, ${LEAVE_TYPE_ID}, '2026-27', 12, 12, ${SEED_ACTOR}, ${SEED_ACTOR})
    `);
  }

  for (const [appId, empId, allocId] of [
    [MANAGER_APP, MANAGER_ID, MANAGER_ALLOC],
    [REPORT1_APP, REPORT1_ID, REPORT1_ALLOC],
    [OUTSIDER_APP, OUTSIDER_ID, OUTSIDER_ALLOC],
  ] as const) {
    await asTenant((tx) => tx`
      INSERT INTO leave.hrms_leave_apps (id, tenant_id, employee_id, leave_type_id, alloc_id, from_date, to_date, days_applied, status, created_by, updated_by)
      VALUES (${appId}, ${TENANT}, ${empId}, ${LEAVE_TYPE_ID}, ${allocId}, '2026-11-01', '2026-11-01', 1, 'pending', ${SEED_ACTOR}, ${SEED_ACTOR})
    `);
  }
  // GAP-HR-LEAVE-03/04: explicit, far-apart created_at values so ordering
  // assertions below don't depend on wall-clock insertion timing.
  await asTenant((tx) => tx`
    INSERT INTO leave.hrms_leave_apps (id, tenant_id, employee_id, leave_type_id, alloc_id, from_date, to_date, days_applied, status, created_at, created_by, updated_by)
    VALUES (${OLDER_APP}, ${TENANT}, ${OUTSIDER_ID}, ${LEAVE_TYPE_ID}, ${OUTSIDER_ALLOC}, '2025-01-10', '2025-01-10', 1, 'pending', '2025-01-01T00:00:00Z', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO leave.hrms_leave_apps (id, tenant_id, employee_id, leave_type_id, alloc_id, from_date, to_date, days_applied, status, created_at, created_by, updated_by)
    VALUES (${NEWER_APP}, ${TENANT}, ${OUTSIDER_ID}, ${LEAVE_TYPE_ID}, ${OUTSIDER_ALLOC}, '2026-12-20', '2026-12-20', 1, 'pending', '2026-12-01T00:00:00Z', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/leave-requests — read scope (GAP-HR-SF-16 item 1)", () => {
  it("self-service employee: sees ONLY their own request", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/leave-requests",
      headers: { authorization: `Bearer ${report1Token}` },
    });
    expect(r.statusCode).toBe(200);
    const ids = (JSON.parse(r.body) as Array<{ id: string }>).map((a) => a.id);
    expect(ids).toEqual([REPORT1_APP]);
  });

  it("self-service employee with NO resolvable employee link fails CLOSED to an empty list", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/leave-requests",
      headers: { authorization: `Bearer ${unlinkedEmpToken}` },
    });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual([]);
  });

  it("manager: sees exactly their direct reports' requests — never their own, never an outsider's (closes the tenant-wide leak)", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/leave-requests",
      headers: { authorization: `Bearer ${managerToken}` },
    });
    expect(r.statusCode).toBe(200);
    const ids = (JSON.parse(r.body) as Array<{ id: string }>).map((a) => a.id);
    expect(ids).toEqual([REPORT1_APP]);
    expect(ids).not.toContain(MANAGER_APP);
    expect(ids).not.toContain(OUTSIDER_APP);
  });

  it("HR: full tenant-wide access is preserved (unchanged), with real employee names resolved", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/leave-requests",
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(r.statusCode).toBe(200);
    const rows = JSON.parse(r.body) as Array<{ id: string; employeeName: string }>;
    const ids = rows.map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining([MANAGER_APP, REPORT1_APP, OUTSIDER_APP]));
    // GAP-HR-LEAVE-03: employee-name resolution now looks up exactly the
    // employees referenced by the returned rows (not "the first 500 in the
    // tenant"), so every seeded row gets a real name, never a UUID fragment
    // or the "Unknown employee" fallback.
    const byId = new Map(rows.map((r) => [r.id, r.employeeName]));
    expect(byId.get(MANAGER_APP)).toBe("Leave Req Manager");
    expect(byId.get(REPORT1_APP)).toBe("Leave Req Report One");
    expect(byId.get(OUTSIDER_APP)).toBe("Leave Req Outsider");
  });

  // GAP-HR-LEAVE-03/04: scoping used to be a post-fetch filter applied on
  // top of an already limit/offset-truncated, UNORDERED tenant-wide query —
  // a scoped caller's own rows could fall outside that page and be silently
  // dropped. Scoping is now in the SQL WHERE clause itself, with a real
  // ORDER BY, so limit/offset paginate the caller's own visible set.
  it("results are ordered newest-first and deterministic — not insertion/wall-clock order", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/leave-requests",
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(r.statusCode).toBe(200);
    const ids = (JSON.parse(r.body) as Array<{ id: string }>).map((a) => a.id);
    // NEWER_APP (created_at 2026-12-01) must sort strictly before OLDER_APP
    // (created_at 2025-01-01) regardless of insertion order.
    expect(ids.indexOf(NEWER_APP)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(OLDER_APP)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(NEWER_APP)).toBeLessThan(ids.indexOf(OLDER_APP));
  });

  it("a scoped caller's own row is still returned even with a small limit that would truncate an unordered tenant-wide page first (regression for the pagination/scope interaction bug)", async () => {
    // With limit=1 pre-fix behaviour (fetch tenant-wide page of 1, THEN
    // filter to the caller's scope) would almost always return zero rows
    // for OUTSIDER unless their single row happened to be the very newest
    // in the whole tenant. Scoping in SQL means limit=1 instead returns
    // exactly OUTSIDER's own newest row.
    // HR passing `empId` collapses resolveLeaveReadScope to a single-element
    // scope ([OUTSIDER_ID]) — the same code path a manager/employee token
    // would hit, without needing a second seeded actor for this assertion.
    const r2 = await app.inject({
      method: "GET", url: `/v1/hrms/leave-requests?limit=1&empId=${OUTSIDER_ID}`,
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(r2.statusCode).toBe(200);
    const rows2 = JSON.parse(r2.body) as Array<{ id: string; employeeId: string }>;
    expect(rows2).toHaveLength(1);
    expect(rows2[0]!.employeeId).toBe(OUTSIDER_ID);
    expect(rows2[0]!.id).toBe(NEWER_APP); // newest of OUTSIDER's 3 rows
  });
});
