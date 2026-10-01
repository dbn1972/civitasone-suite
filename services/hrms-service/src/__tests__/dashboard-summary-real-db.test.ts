/**
 * GET /v1/hrms/dashboard — real-DB round-trip for two backend defects fixed
 * in the HR dashboard gap-remediation cluster:
 *
 *  - GAP-HR-DASHBOARD-07: attendanceTodayPct must be `null` (an honest
 *    "we don't know yet"), never a fabricated `0%`, when the tenant has zero
 *    hrms_attendance rows for today at all (feed not synced). When rows DO
 *    exist, the pre-existing present/headcount formula is deliberately left
 *    unchanged (no prior test suite existed to confirm a different
 *    denominator — e.g. excluding on_leave — was actually intended, so only
 *    the null-vs-zero bug is fixed here).
 *  - GAP-HR-DASHBOARD-06: totalDepartments must be a real, unfiltered count
 *    of this tenant's hrms_departments rows — distinct from
 *    departmentBreakdown, which only lists departments that have at least
 *    one (non-separated) employee, via an INNER JOIN, and is additionally
 *    capped to a top-6-plus-"Others" bucket.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const SEED_ACTOR = "facade00-0d45-4000-8000-0000000000ff";

// Today's date in the same YYYY-MM-DD shape dashboard/queries.ts's
// getDashboard itself computes `today` as, so seeded attendance rows land on
// the exact date the query filters on regardless of which day this suite runs.
const TODAY = new Date().toISOString().slice(0, 10);

function tok(tenant: string, roles: string[], sub: string) {
  return signToken({ sub, tid: tenant, roles, sid: "sess-dash-summary-test" }, SECRET);
}

function asTenant<T>(tenant: string, fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, tenant, fn);
}

// --- Tenant A: zero attendance rows for today (GAP-HR-DASHBOARD-07 null case) ---
const TENANT_A = "facade00-0d45-4000-8000-00000000a000";
const DEPT_A1 = "facade00-0d45-4000-8000-00000000a0d1";
const DESIG_A = "facade00-0d45-4000-8000-00000000a0de";
const EMP_A1 = "facade00-0d45-4000-8000-00000000a0e1";
const EMP_A2 = "facade00-0d45-4000-8000-00000000a0e2";

// --- Tenant B: real attendance rows + 8 departments, only 3 populated
// (GAP-HR-DASHBOARD-07 real-percentage case + GAP-HR-DASHBOARD-06) ---
const TENANT_B = "facade00-0d45-4000-8000-00000000b000";
const DESIG_B = "facade00-0d45-4000-8000-00000000b0de";
const DEPT_B_IDS = Array.from({ length: 8 }, (_, i) => `facade00-0d45-4000-8000-00000000b0d${i}`);
const EMP_B1 = "facade00-0d45-4000-8000-00000000b0e1"; // dept 0, present today
const EMP_B2 = "facade00-0d45-4000-8000-00000000b0e2"; // dept 0, present today
const EMP_B3 = "facade00-0d45-4000-8000-00000000b0e3"; // dept 1, absent today
const EMP_B4 = "facade00-0d45-4000-8000-00000000b0e4"; // dept 2, no attendance row at all today

const HR_TOKEN_A = tok(TENANT_A, ["hr_admin"], "dash-summary-hr-a");
const HR_TOKEN_B = tok(TENANT_B, ["hr_admin"], "dash-summary-hr-b");

let app: Awaited<ReturnType<typeof buildApp>>;

async function cleanup(): Promise<void> {
  for (const t of [TENANT_A, TENANT_B]) {
    await asTenant(t, (tx) => tx`DELETE FROM attendance.hrms_attendance WHERE tenant_id = ${t}`);
    await asTenant(t, (tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${t}`);
    await asTenant(t, (tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${t}`);
    await asTenant(t, (tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${t}`);
  }
}

beforeAll(async () => {
  await cleanup();

  // --- Tenant A seed: 1 department, 2 employees, NO attendance rows today ---
  await asTenant(TENANT_A, (tx) => tx`
    INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DEPT_A1}, ${TENANT_A}, 'DASHQA', 'Dashboard Query Test Dept A', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant(TENANT_A, (tx) => tx`
    INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DESIG_A}, ${TENANT_A}, 'DASHQA', 'Dashboard Query Test Designation A', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  for (const [id, empNo, name] of [
    [EMP_A1, "DASHQA-001", "Dashboard Query A One"],
    [EMP_A2, "DASHQA-002", "Dashboard Query A Two"],
  ] as const) {
    await asTenant(TENANT_A, (tx) => tx`
      INSERT INTO employee.hrms_employees
        (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by)
      VALUES
        (${id}, ${TENANT_A}, ${empNo}, ${name}, ${DEPT_A1}, ${DESIG_A}, '2020-01-01', ${SEED_ACTOR}, ${SEED_ACTOR})
    `);
  }

  // --- Tenant B seed: 8 departments (only 3 have employees), 4 employees,
  // attendance rows for today: 2 present, 1 absent, 1 with no row at all ---
  for (const deptId of DEPT_B_IDS) {
    await asTenant(TENANT_B, (tx) => tx`
      INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
      VALUES (${deptId}, ${TENANT_B}, ${"DASHQB-" + deptId.slice(-1)}, ${"Dashboard Query Test Dept B" + deptId.slice(-1)}, ${SEED_ACTOR}, ${SEED_ACTOR})
    `);
  }
  await asTenant(TENANT_B, (tx) => tx`
    INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DESIG_B}, ${TENANT_B}, 'DASHQB', 'Dashboard Query Test Designation B', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  const EMP_B_ROWS = [
    [EMP_B1, "DASHQB-001", "Dashboard Query B One", DEPT_B_IDS[0]!],
    [EMP_B2, "DASHQB-002", "Dashboard Query B Two", DEPT_B_IDS[0]!],
    [EMP_B3, "DASHQB-003", "Dashboard Query B Three", DEPT_B_IDS[1]!],
    [EMP_B4, "DASHQB-004", "Dashboard Query B Four", DEPT_B_IDS[2]!],
  ] as const;
  for (const [id, empNo, name, deptId] of EMP_B_ROWS) {
    await asTenant(TENANT_B, (tx) => tx`
      INSERT INTO employee.hrms_employees
        (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by)
      VALUES
        (${id}, ${TENANT_B}, ${empNo}, ${name}, ${deptId}, ${DESIG_B}, '2020-01-01', ${SEED_ACTOR}, ${SEED_ACTOR})
    `);
  }
  for (const [empId, status] of [[EMP_B1, "present"], [EMP_B2, "present"], [EMP_B3, "absent"]] as const) {
    await asTenant(TENANT_B, (tx) => tx`
      INSERT INTO attendance.hrms_attendance (id, tenant_id, employee_id, attendance_date, status, created_by, updated_by)
      VALUES (gen_random_uuid(), ${TENANT_B}, ${empId}, ${TODAY}, ${status}, ${SEED_ACTOR}, ${SEED_ACTOR})
    `);
  }
  // GAP-HR-EMPLOYEES-01/06: give tenant B a mix of statuses -- 2 serving
  // (confirmed), 1 on_leave, 1 suspended (neither serving nor on leave).
  for (const [id, status] of [[EMP_B1, "confirmed"], [EMP_B2, "confirmed"], [EMP_B3, "on_leave"], [EMP_B4, "suspended"]] as const) {
    await asTenant(TENANT_B, (tx) => tx`UPDATE employee.hrms_employees SET status = ${status} WHERE id = ${id}`);
  }
  // EMP_B4 deliberately gets NO attendance row today -- still counts toward
  // headcount/totalDepartments, just not toward present/attendanceRowsToday.

  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

interface DashboardResponseBody {
  headcount: number;
  attendanceTodayPct: number | null;
  totalDepartments: number;
  servingCount: number | null;
  onLeave: number;
  departmentBreakdown: { name: string; count: number }[];
}

async function getDashboard(token: string): Promise<{ status: number; body: DashboardResponseBody }> {
  const r = await app.inject({ method: "GET", url: "/v1/hrms/dashboard", headers: { authorization: `Bearer ${token}` } });
  return { status: r.statusCode, body: JSON.parse(r.body) as DashboardResponseBody };
}

describe("GET /v1/hrms/dashboard — GAP-HR-DASHBOARD-07 (attendanceTodayPct null-vs-zero)", () => {
  it("returns null (not a fabricated 0%) when the tenant has zero attendance rows for today", async () => {
    const { status, body } = await getDashboard(HR_TOKEN_A);
    expect(status).toBe(200);
    expect(body.headcount).toBe(2);
    expect(body.attendanceTodayPct).toBeNull();
  });

  it("returns the real present/headcount percentage once attendance rows exist for today, unaffected by an employee with no row at all", async () => {
    const { status, body } = await getDashboard(HR_TOKEN_B);
    expect(status).toBe(200);
    expect(body.headcount).toBe(4);
    // 2 present out of 4 headcount (unchanged pre-existing formula -- see
    // this file's header comment on why the denominator was not changed).
    expect(body.attendanceTodayPct).toBe(50);
  });
});

describe("GET /v1/hrms/dashboard — GAP-HR-DASHBOARD-06 (real totalDepartments count)", () => {
  it("counts every hrms_departments row for the tenant, not just departments with employees", async () => {
    const { status, body } = await getDashboard(HR_TOKEN_B);
    expect(status).toBe(200);
    expect(body.totalDepartments).toBe(8);
    // departmentBreakdown only lists departments with at least one employee
    // (INNER JOIN) -- deliberately smaller here (3 populated of the 8 real
    // departments), demonstrating the two numbers are NOT interchangeable.
    expect(body.departmentBreakdown.length).toBeLessThan(8);
  });

  it("counts a tenant's single department correctly too", async () => {
    const { status, body } = await getDashboard(HR_TOKEN_A);
    expect(status).toBe(200);
    expect(body.totalDepartments).toBe(1);
  });
});

describe("GET /v1/hrms/dashboard — GAP-HR-EMPLOYEES-01 (tenant-wide servingCount)", () => {
  it("counts probation/confirmed/deputation only, separately from onLeave and other statuses", async () => {
    const { status, body } = await getDashboard(HR_TOKEN_B);
    expect(status).toBe(200);
    expect(body.headcount).toBe(4);
    expect(body.servingCount).toBe(2);
    expect(body.onLeave).toBe(1);
    // headcount 4 - serving 2 - onLeave 1 = 1 "other" (the suspended employee).
    expect(body.headcount - (body.servingCount ?? 0) - body.onLeave).toBe(1);
  });
});

describe("GET /v1/hrms/employees?status= — GAP-HR-EMPLOYEES-06 (server-side status filter)", () => {
  async function list(qs: string): Promise<{ status: number; ids: string[] }> {
    const r = await app.inject({ method: "GET", url: `/v1/hrms/employees?limit=50${qs}`, headers: { authorization: `Bearer ${HR_TOKEN_B}` } });
    const body = JSON.parse(r.body) as { data?: Array<{ id: string }> };
    return { status: r.statusCode, ids: (body.data ?? []).map((e) => e.id) };
  }

  it("returns only employees with that status", async () => {
    const res = await list("&status=on_leave");
    expect(res.status).toBe(200);
    expect(res.ids).toEqual([EMP_B3]);
  });

  it("without the filter returns everyone", async () => {
    expect((await list("")).ids.sort()).toEqual([EMP_B1, EMP_B2, EMP_B3, EMP_B4].sort());
  });

  it("rejects a status outside the canonical set", async () => {
    expect((await list("&status=bogus")).status).toBe(400);
  });
});
