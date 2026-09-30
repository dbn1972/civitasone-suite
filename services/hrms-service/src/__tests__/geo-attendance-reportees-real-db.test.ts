/**
 * GET /v1/hrms/attendance/reportees — real-DB regression test.
 *
 * WHY THIS EXISTS (GAP-HR-ATTENDANCE-REPORTEES-01, SEC/DPDP): the route was
 * a never-finished stub — `requireRole(ctx, ALL_ROLES)` (bare "employee"
 * included) gated entry, but the query itself had no employeeId/manager
 * filter at all ("For now return geo attendance for all employees (HR admin
 * view)"), so ANY authenticated caller in the tenant, of any role, got the
 * first 100 geo-attendance rows tenant-wide: every employee's check-in/out
 * location and geofence status. Found as a direct sibling of
 * GAP-HR-ATTENDANCE-05 (this same module's geo-history IDOR fix, PR #1668)
 * while fixing that PR; deliberately not folded into it there to keep that
 * PR narrowly scoped to the single-employee history endpoint.
 *
 * Fixed by resolveReporteesScope in routes.ts: HR_ROLES (this module's
 * existing admin tier) keep the tenant-wide "HR admin view" the stub
 * intended; everyone else — regardless of specific role name, since this
 * module's own vocabulary uses "officer" rather than "manager" — is scoped
 * to their real hrms_employees.managerId direct reports, and fails CLOSED to
 * an empty list with no linked employee record or zero real reports.
 *
 * This runs the real Fastify app against the real Postgres instance.
 * attendance.hrms_geo_attendance and employee.hrms_employees/hrms_
 * departments/hrms_designations all have RLS ENABLEd+FORCEd (migrations
 * 0034, 0026) — direct sqlClient fixture writes with no app.tenant_id GUC
 * set fail closed (0 rows), so seeding/cleanup/verification queries go
 * through withRawTenantGuc, same convention as manager-employee-read-scope-
 * real-db.test.ts. It also proves the new DPDP audit-on-read event lands in
 * _outbox.messages via the async consumer (mirrors GAP-HR-MEDICAL-01's
 * identical list-read-audit pattern) — this dev environment's outbox table
 * has RLS live-enabled regardless of any doc comment claiming otherwise, so
 * the consumer wraps its insert in db.transaction() (geo-attendance/
 * consumer.ts's geoAttendanceReporteesRead subscriber).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { registerGeoAttendanceConsumers } from "../modules/geo-attendance/consumer.js";

// buildApp() registers routes only, not consumers (each runs in a separate
// worker process in production) — the new list-read audit event is
// published via the queue and recorded by geo-attendance/consumer.ts's own
// subscriber, so this file needs it registered against the SAME global
// `queue` singleton routes.ts publishes to. Same convention as
// medical-claims-real-db.test.ts's registerMedicalConsumers(queue) call.
registerGeoAttendanceConsumers(queue);

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT       = "facade00-0900-4000-8000-000000000900";
const SEED_ACTOR    = "facade00-0900-4000-8000-000000000099"; // created_by filler
const DEPT_ID       = "facade00-0900-4000-8000-0000000000d1";
const DESIG_ID      = "facade00-0900-4000-8000-0000000000d2";
const OFFICER_ID    = "facade00-0900-4000-8000-0000000000e1";
const REPORT1_ID    = "facade00-0900-4000-8000-0000000000e2";
const REPORT2_ID    = "facade00-0900-4000-8000-0000000000e3";
const OUTSIDER_ID   = "facade00-0900-4000-8000-0000000000e4"; // exists, not a report; also a zero-reports officer

// Actor subs are UUID-shaped (unlike manager-employee-read-scope-real-db.
// test.ts's plain-string subs) because this test's audit-trail assertions
// exercise _outbox.messages, whose actor_id column is `uuid NOT NULL` —
// verified directly against the live schema (\d _outbox.messages) rather
// than assumed. Same convention medical-claims-real-db.test.ts's
// MANAGER_SUB/UNLINKED_MGR_SUB already use for the identical reason.
const OFFICER_SUB          = "facade00-0900-4000-8000-0000000000f1"; // linked to OFFICER_ID via user_ref
const UNLINKED_OFFICER_SUB = "facade00-0900-4000-8000-0000000000f2"; // "officer" role, no hrms_employees row at all
const OUTSIDER_SUB         = "facade00-0900-4000-8000-0000000000f3"; // linked to OUTSIDER_ID — a real employee with ZERO reports
const HR_SUB               = "facade00-0900-4000-8000-0000000000f4";
const BARE_EMPLOYEE_SUB    = "facade00-0900-4000-8000-0000000000f5"; // "employee" role, no hrms_employees row at all

function tok(roles: string[], sub: string) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-reportees-scope-test" }, SECRET);
}
const officerToken         = tok(["officer"], OFFICER_SUB);
const unlinkedOfficerToken = tok(["officer"], UNLINKED_OFFICER_SUB);
const zeroReportsToken     = tok(["officer"], OUTSIDER_SUB);
const hrToken              = tok(["hr_admin"], HR_SUB);
const bareEmployeeToken    = tok(["employee"], BARE_EMPLOYEE_SUB);

// RLS is ENABLE+FORCEd on employee.hrms_employees/hrms_departments/
// hrms_designations (migrations 0026/0034) and attendance.hrms_geo_
// attendance (migration 0034) — reuse the exact convention documented in
// manager-employee-read-scope-real-db.test.ts.
function asTenant<T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, TENANT, fn);
}

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM attendance.hrms_geo_attendance WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

async function seedGeoRow(employeeId: string): Promise<void> {
  await asTenant((tx) => tx`
    INSERT INTO attendance.hrms_geo_attendance
      (id, tenant_id, employee_id, attendance_date, check_type, latitude, longitude,
       within_geofence, distance_from_office_meters, selfie_file_key, marked_at, created_by)
    VALUES
      (${randomUUID()}, ${TENANT}, ${employeeId}, CURRENT_DATE, 'check_in', 28.6139, 77.2090,
       true, 12.5, 'selfies/should-not-leak-in-list-view.jpg', now(), ${SEED_ACTOR})
  `);
}

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  await cleanup();

  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DEPT_ID}, ${TENANT}, 'REPSCOPE', 'Reportees Scope Test Dept', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DESIG_ID}, ${TENANT}, 'REPSCOPE', 'Reportees Scope Test Designation', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  // The reporting officer — linked to officerToken's JWT `sub` via user_ref,
  // so resolveEmployeeForActor's primary lookup finds it.
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, user_ref, created_by, updated_by)
    VALUES
      (${OFFICER_ID}, ${TENANT}, 'REPSCOPE-001', 'Reportees Scope Test Officer', ${DEPT_ID}, ${DESIG_ID}, '2020-01-01', ${OFFICER_SUB}, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  // Two direct reports (manager_id = OFFICER_ID).
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, manager_id, created_by, updated_by)
    VALUES
      (${REPORT1_ID}, ${TENANT}, 'REPSCOPE-002', 'Reportees Scope Test Report One', ${DEPT_ID}, ${DESIG_ID}, '2021-01-01', ${OFFICER_ID}, ${SEED_ACTOR}, ${SEED_ACTOR}),
      (${REPORT2_ID}, ${TENANT}, 'REPSCOPE-003', 'Reportees Scope Test Report Two', ${DEPT_ID}, ${DESIG_ID}, '2021-06-01', ${OFFICER_ID}, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  // Exists in the SAME tenant, does not report to OFFICER_ID, and has ZERO
  // reports of their own — also linked via user_ref (OUTSIDER_SUB) so it
  // doubles as the "linked but zero real reports" fail-closed case, distinct
  // from "no employee record at all".
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, user_ref, created_by, updated_by)
    VALUES
      (${OUTSIDER_ID}, ${TENANT}, 'REPSCOPE-004', 'Reportees Scope Test Outsider', ${DEPT_ID}, ${DESIG_ID}, '2019-01-01', ${OUTSIDER_SUB}, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  // Geo-attendance rows for the officer themselves, both reports, and the
  // outsider — each carries a selfieFileKey to prove the list response
  // never surfaces it, for any role.
  await seedGeoRow(OFFICER_ID);
  await seedGeoRow(REPORT1_ID);
  await seedGeoRow(REPORT2_ID);
  await seedGeoRow(OUTSIDER_ID);

  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

async function drainQueue(): Promise<void> {
  await (queue as unknown as { drain: () => Promise<void> }).drain();
}

async function callReportees(token: string) {
  return app.inject({
    method: "GET",
    url: "/v1/hrms/attendance/reportees",
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("GET /v1/hrms/attendance/reportees — GAP-HR-ATTENDANCE-REPORTEES-01: scope", () => {
  it("REPRODUCTION: a bare employee with no linked record must not see the tenant-wide leak (the original bug)", async () => {
    const r = await callReportees(bareEmployeeToken);
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toEqual([]);
  });

  it("a reporting officer sees exactly their direct reports' attendance — not the outsider's, not their own", async () => {
    const r = await callReportees(officerToken);
    expect(r.statusCode).toBe(200);
    const ids = (r.json().data as Array<{ employeeId: string }>).map((d) => d.employeeId);
    expect(ids.sort()).toEqual([REPORT1_ID, REPORT2_ID].sort());
    expect(ids).not.toContain(OUTSIDER_ID);
    expect(ids).not.toContain(OFFICER_ID); // "my reportees" = direct reports, not self
  });

  it("an officer-role token with NO resolvable employee link fails CLOSED to an empty list", async () => {
    const r = await callReportees(unlinkedOfficerToken);
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toEqual([]);
  });

  it("a linked officer with a real employee record but ZERO direct reports also fails CLOSED to an empty list (not an error)", async () => {
    const r = await callReportees(zeroReportsToken);
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toEqual([]);
  });

  it("hr_admin's tenant-wide access is unaffected — sees the outsider and the officer too", async () => {
    const r = await callReportees(hrToken);
    expect(r.statusCode).toBe(200);
    const ids = (r.json().data as Array<{ employeeId: string }>).map((d) => d.employeeId);
    expect(ids).toContain(OUTSIDER_ID);
    expect(ids).toContain(OFFICER_ID);
    expect(ids).toContain(REPORT1_ID);
    expect(ids).toContain(REPORT2_ID);
  });

  it("response never includes selfieFileKey, for any role — this is a list view, not the geo-history detail view", async () => {
    const r = await callReportees(hrToken);
    expect(r.statusCode).toBe(200);
    const rows = r.json().data as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).not.toHaveProperty("selfieFileKey");
    }
  });
});

describe("GET /v1/hrms/attendance/reportees — GAP-HR-ATTENDANCE-REPORTEES-01: DPDP audit trail", () => {
  async function latestReporteesAuditRow(): Promise<{ payload: Record<string, unknown> } | undefined> {
    const [row] = await asTenant((tx) => tx`
      SELECT payload FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND topic = 'audit.event.record'
        AND payload->>'resourceType' = 'geo_attendance_reportees' AND payload->>'action' = 'list'
      ORDER BY created_at DESC LIMIT 1
    `);
    return row as { payload: Record<string, unknown> } | undefined;
  }

  it("a reporting officer's real-reports read emits a DPDP audit.event.record row scoped to them", async () => {
    const r = await callReportees(officerToken);
    expect(r.statusCode).toBe(200);
    await drainQueue();
    const auditRow = await latestReporteesAuditRow();
    if (!auditRow) throw new Error("expected an audit.event.record row after an officer reportees read");
    expect(auditRow.payload.action).toBe("list");
    expect(auditRow.payload.resourceType).toBe("geo_attendance_reportees");
    expect(auditRow.payload.resourceId).toBe(OFFICER_ID);
    expect(auditRow.payload.rowCount).toBe(2);
  });

  it("hr_admin's tenant-wide read also emits a DPDP audit event (any privileged bulk read of others' location data is audited)", async () => {
    const [before] = await asTenant((tx) => tx`
      SELECT count(*)::int AS n FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND topic = 'audit.event.record'
        AND payload->>'resourceType' = 'geo_attendance_reportees' AND payload->>'action' = 'list'
    `);
    const r = await callReportees(hrToken);
    expect(r.statusCode).toBe(200);
    await drainQueue();
    const [after] = await asTenant((tx) => tx`
      SELECT count(*)::int AS n FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND topic = 'audit.event.record'
        AND payload->>'resourceType' = 'geo_attendance_reportees' AND payload->>'action' = 'list'
    `);
    expect(after?.n).toBe((before?.n ?? 0) + 1);
  });

  it("the fail-closed empty-list case does NOT emit an audit event (nothing was actually disclosed)", async () => {
    const [before] = await asTenant((tx) => tx`
      SELECT count(*)::int AS n FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND topic = 'audit.event.record'
        AND payload->>'resourceType' = 'geo_attendance_reportees' AND payload->>'action' = 'list'
    `);
    const r = await callReportees(unlinkedOfficerToken);
    expect(r.statusCode).toBe(200);
    await drainQueue();
    const [after] = await asTenant((tx) => tx`
      SELECT count(*)::int AS n FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND topic = 'audit.event.record'
        AND payload->>'resourceType' = 'geo_attendance_reportees' AND payload->>'action' = 'list'
    `);
    expect(after?.n).toBe(before?.n);
  });
});
