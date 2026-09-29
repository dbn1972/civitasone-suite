/**
 * Manager-scope regression test for GET /v1/hrms/shift-requests,
 * /wfh-requests, /overtime-requests and /attendance/checkin-log — real-DB
 * round-trip (GAP-HR-SF-16 fold-in: SHIFT-REQUESTS-01 / WFH-02 / OVERTIME-03,
 * plus checkin-log, referenced by the same self-scoping pattern).
 *
 * SEC finding: resolveSelfScopedEmployeeId bundled "manager" together with
 * HR as fully privileged — `requested` (or its absence) passed straight
 * through with NO ownership check, so any manager could omit empId to read
 * every employee's shift/WFH/overtime requests tenant-wide, or pass an
 * arbitrary colleague's employeeId (not even a direct report) and read
 * their requests directly. checkin-log had no scoping at all (no empId
 * param existed). Fixed: a manager is now scoped to self + direct reports,
 * never the full tenant, and never an id outside that set even if
 * explicitly requested (denied, not silently substituted). HR and bare
 * "employee" behavior are unchanged.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT       = "facade00-0f19-4000-8000-000000000f19";
const SEED_ACTOR    = "facade00-0f19-4000-8000-0000000000ff";
const DEPT_ID       = "facade00-0f19-4000-8000-0000000000d1";
const DESIG_ID      = "facade00-0f19-4000-8000-0000000000d2";

const MANAGER_ID  = "facade00-0f19-4000-8000-0000000000e1";
const REPORT1_ID  = "facade00-0f19-4000-8000-0000000000e2";
const REPORT2_ID  = "facade00-0f19-4000-8000-0000000000e3";
const OUTSIDER_ID = "facade00-0f19-4000-8000-0000000000e4"; // same tenant, NOT a report

const MANAGER_SUB      = "atd-scope-mgr-f19";
const REPORT1_SUB      = "atd-scope-report1-f19";
const UNLINKED_MGR_SUB = "atd-scope-unlinked-mgr-f19";
const HR_SUB           = "atd-scope-hr-f19";

function tok(roles: string[], sub: string) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-atd-scope-test" }, SECRET);
}
const managerToken     = tok(["manager"], MANAGER_SUB);
const report1Token     = tok(["employee"], REPORT1_SUB);
const unlinkedMgrToken = tok(["manager"], UNLINKED_MGR_SUB);
const hrToken          = tok(["hr_admin"], HR_SUB);

let app: Awaited<ReturnType<typeof buildApp>>;

function asTenant<T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, TENANT, fn);
}

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM attendance.hrms_shift_change_requests WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM attendance.hrms_wfh_requests WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM attendance.hrms_overtime_requests WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM attendance.hrms_attendance WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

const EMPLOYEES = [
  [MANAGER_ID, "ATDSCP-001", "Attendance Scope Manager", undefined, MANAGER_SUB],
  [REPORT1_ID, "ATDSCP-002", "Attendance Scope Report One", MANAGER_ID, REPORT1_SUB],
  [REPORT2_ID, "ATDSCP-003", "Attendance Scope Report Two", MANAGER_ID, undefined],
  [OUTSIDER_ID, "ATDSCP-004", "Attendance Scope Outsider", undefined, undefined],
] as const;

beforeAll(async () => {
  await cleanup();

  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DEPT_ID}, ${TENANT}, 'ATDSCP', 'Attendance Scope Test Dept', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DESIG_ID}, ${TENANT}, 'ATDSCP', 'Attendance Scope Test Designation', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  for (const [id, empNo, name, managerId, userRef] of EMPLOYEES) {
    await asTenant((tx) => tx`
      INSERT INTO employee.hrms_employees
        (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, manager_id, user_ref, created_by, updated_by)
      VALUES
        (${id}, ${TENANT}, ${empNo}, ${name}, ${DEPT_ID}, ${DESIG_ID}, '2020-01-01', ${managerId ?? null}, ${userRef ?? null}, ${SEED_ACTOR}, ${SEED_ACTOR})
    `);
  }

  for (const [, , , , empId] of [
    [0, 0, 0, 0, MANAGER_ID], [0, 0, 0, 0, REPORT1_ID], [0, 0, 0, 0, REPORT2_ID], [0, 0, 0, 0, OUTSIDER_ID],
  ] as const) {
    await asTenant((tx) => tx`
      INSERT INTO attendance.hrms_shift_change_requests (id, tenant_id, employee_id, current_shift, requested_shift, effective_date, status)
      VALUES (gen_random_uuid(), ${TENANT}, ${empId}, 'day', 'night', '2026-11-01', 'pending')
    `);
    await asTenant((tx) => tx`
      INSERT INTO attendance.hrms_wfh_requests (id, tenant_id, employee_id, from_date, to_date, status)
      VALUES (gen_random_uuid(), ${TENANT}, ${empId}, '2026-11-01', '2026-11-02', 'pending')
    `);
    await asTenant((tx) => tx`
      INSERT INTO attendance.hrms_overtime_requests (id, tenant_id, employee_id, request_date, hours_requested, status, created_by, updated_by)
      VALUES (gen_random_uuid(), ${TENANT}, ${empId}, '2026-11-01', 2.5, 'pending', ${SEED_ACTOR}, ${SEED_ACTOR})
    `);
    await asTenant((tx) => tx`
      INSERT INTO attendance.hrms_attendance (id, tenant_id, employee_id, attendance_date, status, created_by, updated_by)
      VALUES (gen_random_uuid(), ${TENANT}, ${empId}, '2026-11-01', 'present', ${SEED_ACTOR}, ${SEED_ACTOR})
    `);
  }

  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

async function empIds(url: string, token: string): Promise<{ status: number; ids: string[] }> {
  const r = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
  const body = JSON.parse(r.body);
  const rows = (body.data ?? body) as Array<{ employeeId: string }>;
  return { status: r.statusCode, ids: rows.map((row) => row.employeeId) };
}

describe("GET /v1/hrms/shift-requests — manager scope", () => {
  it("manager with no empId: sees self + direct reports only, never the outsider (closes tenant-wide leak)", async () => {
    const { status, ids } = await empIds("/v1/hrms/shift-requests", managerToken);
    expect(status).toBe(200);
    expect(ids.sort()).toEqual([MANAGER_ID, REPORT1_ID, REPORT2_ID].sort());
    expect(ids).not.toContain(OUTSIDER_ID);
  });

  it("manager explicitly requesting the OUTSIDER's empId: denied (empty), not substituted (IDOR closed)", async () => {
    const { status, ids } = await empIds(`/v1/hrms/shift-requests?empId=${OUTSIDER_ID}`, managerToken);
    expect(status).toBe(200);
    expect(ids).toEqual([]);
  });

  it("manager explicitly requesting a real direct report's empId: scoped to just that report", async () => {
    const { status, ids } = await empIds(`/v1/hrms/shift-requests?empId=${REPORT1_ID}`, managerToken);
    expect(status).toBe(200);
    expect(ids).toEqual([REPORT1_ID]);
  });

  it("manager requesting their OWN empId: 200 with just their own row — must not be locked out of their own data", async () => {
    const { status, ids } = await empIds(`/v1/hrms/shift-requests?empId=${MANAGER_ID}`, managerToken);
    expect(status).toBe(200);
    expect(ids).toEqual([MANAGER_ID]);
  });

  it("manager with no resolvable employee link: empty (fail closed)", async () => {
    const { status, ids } = await empIds("/v1/hrms/shift-requests", unlinkedMgrToken);
    expect(status).toBe(200);
    expect(ids).toEqual([]);
  });

  it("bare employee: sees only their own row (unchanged)", async () => {
    const { status, ids } = await empIds("/v1/hrms/shift-requests", report1Token);
    expect(status).toBe(200);
    expect(ids).toEqual([REPORT1_ID]);
  });

  it("HR: full tenant-wide access preserved (unchanged)", async () => {
    const { status, ids } = await empIds("/v1/hrms/shift-requests", hrToken);
    expect(status).toBe(200);
    expect(ids.sort()).toEqual([MANAGER_ID, REPORT1_ID, REPORT2_ID, OUTSIDER_ID].sort());
  });
});

describe("GET /v1/hrms/wfh-requests — manager scope", () => {
  it("manager with no empId: sees self + direct reports only, never the outsider", async () => {
    const { status, ids } = await empIds("/v1/hrms/wfh-requests", managerToken);
    expect(status).toBe(200);
    expect(ids.sort()).toEqual([MANAGER_ID, REPORT1_ID, REPORT2_ID].sort());
    expect(ids).not.toContain(OUTSIDER_ID);
  });

  it("manager explicitly requesting the OUTSIDER's empId: denied (empty)", async () => {
    const { status, ids } = await empIds(`/v1/hrms/wfh-requests?empId=${OUTSIDER_ID}`, managerToken);
    expect(status).toBe(200);
    expect(ids).toEqual([]);
  });

  it("HR: full tenant-wide access preserved (unchanged)", async () => {
    const { status, ids } = await empIds("/v1/hrms/wfh-requests", hrToken);
    expect(status).toBe(200);
    expect(ids.sort()).toEqual([MANAGER_ID, REPORT1_ID, REPORT2_ID, OUTSIDER_ID].sort());
  });
});

describe("GET /v1/hrms/overtime-requests — manager scope", () => {
  it("manager with no empId: sees self + direct reports only, never the outsider", async () => {
    const { status, ids } = await empIds("/v1/hrms/overtime-requests", managerToken);
    expect(status).toBe(200);
    expect(ids.sort()).toEqual([MANAGER_ID, REPORT1_ID, REPORT2_ID].sort());
    expect(ids).not.toContain(OUTSIDER_ID);
  });

  it("manager explicitly requesting the OUTSIDER's empId: denied (empty)", async () => {
    const { status, ids } = await empIds(`/v1/hrms/overtime-requests?empId=${OUTSIDER_ID}`, managerToken);
    expect(status).toBe(200);
    expect(ids).toEqual([]);
  });

  it("HR: full tenant-wide access preserved (unchanged)", async () => {
    const { status, ids } = await empIds("/v1/hrms/overtime-requests", hrToken);
    expect(status).toBe(200);
    expect(ids.sort()).toEqual([MANAGER_ID, REPORT1_ID, REPORT2_ID, OUTSIDER_ID].sort());
  });
});

describe("GET /v1/hrms/attendance/checkin-log — manager scope", () => {
  it("manager: sees self + direct reports only, never the outsider (previously had ZERO scoping)", async () => {
    const { status, ids } = await empIds("/v1/hrms/attendance/checkin-log", managerToken);
    expect(status).toBe(200);
    expect(ids.sort()).toEqual([MANAGER_ID, REPORT1_ID, REPORT2_ID].sort());
    expect(ids).not.toContain(OUTSIDER_ID);
  });

  it("HR: full tenant-wide access preserved (unchanged)", async () => {
    const { status, ids } = await empIds("/v1/hrms/attendance/checkin-log", hrToken);
    expect(status).toBe(200);
    expect(ids.sort()).toEqual([MANAGER_ID, REPORT1_ID, REPORT2_ID, OUTSIDER_ID].sort());
  });
});
