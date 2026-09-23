/**
 * Manager read-scope regression test — real-DB round-trip.
 *
 * SEC finding (HRMS role-based review): READER_ROLES on GET /v1/hrms/employees
 * and GET /v1/hrms/employees/:id includes bare "manager", and neither
 * underlying query (employee/queries.ts, employee/repo.ts) took any
 * actor/reporting-chain parameter at all — a caller whose only qualifying
 * role was "manager" could read ANY employee tenant-wide (department,
 * designation, grade, posting location, masked financial fields), not just
 * people who actually report to them. Editing was already correctly scoped
 * (the PATCH route's role list excludes "manager") — this closes the
 * matching read-scope gap.
 *
 * Scoping decision — DIRECT REPORTS ONLY, not the full reporting subtree:
 * matches the one existing precedent in this codebase for "manager scoped to
 * their people", leave/routes.ts's enforceCcsLeaveRules ownership check
 * ("isManagerOfTarget = ctx.roles.includes('manager') && actorEmp != null &&
 * emp.managerId === actorEmp.id"), which also uses hrmsEmployees.managerId
 * directly rather than any subtree walk. hrms_employees additionally carries
 * live `reporting_officer_id`/`hod_id` columns (added by
 * migrations/0007_geo_attendance_ro.sql) — investigated and deliberately NOT
 * used here: neither is mapped in schema.ts (no Drizzle column at all) and no
 * application code reads or writes either one; that same migration's own
 * comment ("managerId already exists, we use it as reporting officer")
 * documents managerId (added earlier, in migrations/0003) as the intended
 * field, and it is what every real "who reports to whom" consumer in this
 * codebase (orgchart's tree-building, leave's exemption check above) already
 * uses.
 *
 * "Exists but not yours" response shape — 403 FORBIDDEN, not a disguised
 * 404: matches leave/routes.ts's identical ownership-check precedent
 * (HttpError(403, "FORBIDDEN", "...or, for managers, a direct report's)")).
 * The employee id space is an unguessable UUID, so a 403 here does not
 * meaningfully aid enumeration the way it might for a sequential id.
 *
 * Also covers the fail-closed edge case: a "manager"-role token whose
 * hrms_employees link cannot be resolved at all (see actor-link.ts's
 * resolveEmployeeForActor) must see NOTHING (empty list / 403), never fall
 * back to unscoped tenant-wide access.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT     = "facade00-0700-4000-8000-000000000700";
const SEED_ACTOR  = "facade00-0700-4000-8000-000000000099"; // created_by/updated_by filler
const DEPT_ID     = "facade00-0700-4000-8000-0000000000d1";
const DESIG_ID    = "facade00-0700-4000-8000-0000000000d2";
const MANAGER_ID  = "facade00-0700-4000-8000-0000000000e1";
const REPORT1_ID  = "facade00-0700-4000-8000-0000000000e2";
const REPORT2_ID  = "facade00-0700-4000-8000-0000000000e3";
const OUTSIDER_ID = "facade00-0700-4000-8000-0000000000e4";
const FAKE_ID     = "00000000-dead-4000-8000-ffffffffffff"; // never inserted — genuinely nonexistent

const MANAGER_SUB       = "mgr-facade-700";       // linked via hrms_employees.user_ref = MANAGER_ID's row
const UNLINKED_MGR_SUB  = "mgr-unlinked-facade-700"; // "manager" role, no matching employee row at all
const HR_MANAGER_SUB    = "hr-mgr-facade-700";    // hr_admin + manager combo — must be unaffected

function tok(roles: string[], sub: string) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-mgr-scope-test" }, SECRET);
}
const managerToken     = tok(["manager"], MANAGER_SUB);
const unlinkedMgrToken = tok(["manager"], UNLINKED_MGR_SUB);
const hrManagerToken   = tok(["hr_admin", "manager"], HR_MANAGER_SUB);

// RLS is ENABLE+FORCEd on employee.hrms_employees/hrms_departments/
// hrms_designations (migrations/0026, 0034) — direct sqlClient writes with no
// app.tenant_id GUC set fail closed (0 rows), same trap documented in
// actor-link.ts's auto-link comment and hrms-claims-schema-real-db.test.ts's
// asTenant helper. Reuse that exact convention here.
function asTenant<T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, TENANT, fn);
}

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  await cleanup();

  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DEPT_ID}, ${TENANT}, 'MGRSCOPE', 'Manager Scope Test Dept', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DESIG_ID}, ${TENANT}, 'MGRSCOPE', 'Manager Scope Test Designation', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  // The manager — linked to managerToken's JWT `sub` via user_ref, so
  // resolveEmployeeForActor's primary (userRef) lookup finds it.
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, user_ref, created_by, updated_by)
    VALUES
      (${MANAGER_ID}, ${TENANT}, 'MGRSCOPE-001', 'Manager Scope Test Manager', ${DEPT_ID}, ${DESIG_ID}, '2020-01-01', ${MANAGER_SUB}, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  // Two direct reports (manager_id = MANAGER_ID).
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, manager_id, created_by, updated_by)
    VALUES
      (${REPORT1_ID}, ${TENANT}, 'MGRSCOPE-002', 'Manager Scope Test Report One', ${DEPT_ID}, ${DESIG_ID}, '2021-01-01', ${MANAGER_ID}, ${SEED_ACTOR}, ${SEED_ACTOR}),
      (${REPORT2_ID}, ${TENANT}, 'MGRSCOPE-003', 'Manager Scope Test Report Two', ${DEPT_ID}, ${DESIG_ID}, '2021-06-01', ${MANAGER_ID}, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  // Exists in the SAME tenant, but does not report to MANAGER_ID — the
  // "exists but not yours" case.
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by)
    VALUES
      (${OUTSIDER_ID}, ${TENANT}, 'MGRSCOPE-004', 'Manager Scope Test Outsider', ${DEPT_ID}, ${DESIG_ID}, '2019-01-01', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/employees — manager read scope", () => {
  it("manager-only token: list contains exactly this manager's direct reports", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/employees?limit=50&offset=0",
      headers: { authorization: `Bearer ${managerToken}` },
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body) as { data: Array<{ id: string }> };
    const ids = body.data.map((e) => e.id);
    expect(ids).toContain(REPORT1_ID);
    expect(ids).toContain(REPORT2_ID);
    expect(ids).not.toContain(OUTSIDER_ID);
    expect(ids).not.toContain(MANAGER_ID); // "my team" = direct reports, not self
  });

  it("manager-only token with NO resolvable employee link fails CLOSED to an empty list", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/employees?limit=50&offset=0",
      headers: { authorization: `Bearer ${unlinkedMgrToken}` },
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it("hr_admin who ALSO holds manager is unaffected — sees the outsider too", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/employees?limit=50&offset=0",
      headers: { authorization: `Bearer ${hrManagerToken}` },
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body) as { data: Array<{ id: string }> };
    const ids = body.data.map((e) => e.id);
    expect(ids).toContain(OUTSIDER_ID);
    expect(ids).toContain(REPORT1_ID);
    expect(ids).toContain(REPORT2_ID);
  });
});

describe("GET /v1/hrms/employees/:id — manager read scope", () => {
  it("manager-only token: 200 for a direct report's detail", async () => {
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/employees/${REPORT1_ID}`,
      headers: { authorization: `Bearer ${managerToken}` },
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body) as { id: string };
    expect(body.id).toBe(REPORT1_ID);
  });

  it("manager-only token: 403 for a non-report's detail (exists, but not theirs)", async () => {
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/employees/${OUTSIDER_ID}`,
      headers: { authorization: `Bearer ${managerToken}` },
    });
    expect(r.statusCode).toBe(403);
    const body = JSON.parse(r.body) as { code: string };
    expect(body.code).toBe("FORBIDDEN");
  });

  it("manager-only token with no resolvable employee link: 403, fails closed even for a real id", async () => {
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/employees/${REPORT1_ID}`,
      headers: { authorization: `Bearer ${unlinkedMgrToken}` },
    });
    expect(r.statusCode).toBe(403);
  });

  it("manager-only token: 404 (not 403) for a genuinely nonexistent id — unchanged for every role", async () => {
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/employees/${FAKE_ID}`,
      headers: { authorization: `Bearer ${managerToken}` },
    });
    expect(r.statusCode).toBe(404);
  });

  it("hr_admin who ALSO holds manager is unaffected — 200 for the outsider's detail", async () => {
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/employees/${OUTSIDER_ID}`,
      headers: { authorization: `Bearer ${hrManagerToken}` },
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body) as { id: string };
    expect(body.id).toBe(OUTSIDER_ID);
  });
});
