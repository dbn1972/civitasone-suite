/**
 * Manager/self/HR-scope regression test for GET /v1/hrms/attendance/face-log
 * — real-DB round-trip. Mirrors the shape of
 * attendance-manager-scope-real-db.test.ts (GAP-HR-SF-10/SF-16) and
 * geo-attendance/routes.ts's GAP-HR-ATTENDANCE-05 (PR #1668) regression
 * tests -- same fixture/token conventions, same asTenant() raw-SQL seeding
 * (attendance.hrms_face_verification_log has FORCE ROW LEVEL SECURITY, so
 * seeding goes through withRawTenantGuc exactly like those two files).
 *
 * SEC finding (found in passing by a reviewer checking an unrelated PR in
 * this campaign, then verified fresh against current source before this
 * fix): `employeeId` on this route was mandatory but never checked against
 * the caller's own (or a direct report's) resolved employee id -- ANY
 * authenticated caller under ALL_ROLES (bare "employee" included) could
 * read another employee's face-verification history (match/no-match
 * outcome, similarity score, method, processing time) simply by naming a
 * different uuid in the query string. This is biometric-verification data,
 * DPDP/PII-sensitive -- see this PR's description for the required human
 * review flag.
 *
 * Fixed: employeeId is now resolved via resolveFaceLogScope (routes.ts) --
 * self (any role), a manager's own direct reports (managerId FK), or full
 * HR-role access; anyone else is rejected (403), and a caller with no
 * linked employee record and no privileged role is rejected too (fails
 * closed, never falls through to an unfiltered/substituted read).
 *
 * The route's response intentionally omits `employeeId` from each row (see
 * routes.ts's field-mapping), so these tests identify "whose data came
 * back" by seeding exactly one distinguishable face-verification-log row
 * per employee (a controlled `id`) and asserting on which row id(s) are
 * returned, rather than on an employeeId field the response doesn't carry.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT    = "faceface-0000-4000-8000-000000000000";
const SEED_ACTOR = "faceface-0000-4000-8000-0000000000ff";
const DEPT_ID    = "faceface-0000-4000-8000-0000000000d1";
const DESIG_ID   = "faceface-0000-4000-8000-0000000000d2";

const MANAGER_ID  = "faceface-0000-4000-8000-0000000000e1";
const REPORT1_ID  = "faceface-0000-4000-8000-0000000000e2";
const OUTSIDER_ID = "faceface-0000-4000-8000-0000000000e3"; // same tenant, NOT a report of MANAGER_ID

const MANAGER_LOG_ID  = "faceface-0000-4000-8000-0000000000a1";
const REPORT1_LOG_ID  = "faceface-0000-4000-8000-0000000000a2";
const OUTSIDER_LOG_ID = "faceface-0000-4000-8000-0000000000a3";

const MANAGER_SUB      = "facelog-scope-mgr";
const REPORT1_SUB      = "facelog-scope-report1";
const OUTSIDER_SUB     = "facelog-scope-outsider";
const UNLINKED_MGR_SUB = "facelog-scope-unlinked-mgr";
const HR_SUB           = "facelog-scope-hr";

function tok(roles: string[], sub: string) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-facelog-scope-test" }, SECRET);
}
const managerToken     = tok(["manager"], MANAGER_SUB);
const report1Token     = tok(["employee"], REPORT1_SUB);
const outsiderToken    = tok(["employee"], OUTSIDER_SUB);
const unlinkedMgrToken = tok(["manager"], UNLINKED_MGR_SUB);
const hrToken          = tok(["hr_admin"], HR_SUB);

let app: Awaited<ReturnType<typeof buildApp>>;

function asTenant<T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, TENANT, fn);
}

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM attendance.hrms_face_verification_log WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

const EMPLOYEES = [
  [MANAGER_ID, "FACELOG-001", "Face Log Scope Manager", undefined, MANAGER_SUB],
  [REPORT1_ID, "FACELOG-002", "Face Log Scope Report One", MANAGER_ID, REPORT1_SUB],
  [OUTSIDER_ID, "FACELOG-003", "Face Log Scope Outsider", undefined, OUTSIDER_SUB],
] as const;

const FACE_LOGS = [
  [MANAGER_LOG_ID, MANAGER_ID],
  [REPORT1_LOG_ID, REPORT1_ID],
  [OUTSIDER_LOG_ID, OUTSIDER_ID],
] as const;

beforeAll(async () => {
  await cleanup();

  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DEPT_ID}, ${TENANT}, 'FACELOG', 'Face Log Scope Test Dept', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DESIG_ID}, ${TENANT}, 'FACELOG', 'Face Log Scope Test Designation', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  for (const [id, empNo, name, managerId, userRef] of EMPLOYEES) {
    await asTenant((tx) => tx`
      INSERT INTO employee.hrms_employees
        (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, manager_id, user_ref, created_by, updated_by)
      VALUES
        (${id}, ${TENANT}, ${empNo}, ${name}, ${DEPT_ID}, ${DESIG_ID}, '2020-01-01', ${managerId ?? null}, ${userRef ?? null}, ${SEED_ACTOR}, ${SEED_ACTOR})
    `);
  }

  for (const [logId, employeeId] of FACE_LOGS) {
    await asTenant((tx) => tx`
      INSERT INTO attendance.hrms_face_verification_log
        (id, tenant_id, employee_id, selfie_key, profile_photo_key, verification_method, confidence_threshold, is_match)
      VALUES
        (${logId}, ${TENANT}, ${employeeId}, 'test-selfie-key', 'test-profile-key', 'onnx', 0.75, true)
    `);
  }

  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

async function faceLog(employeeId: string, token: string): Promise<{ status: number; ids: string[] }> {
  const r = await app.inject({
    method: "GET",
    url: `/v1/hrms/attendance/face-log?employeeId=${employeeId}`,
    headers: { authorization: `Bearer ${token}` },
  });
  const body = JSON.parse(r.body);
  const ids = Array.isArray(body.data) ? (body.data as Array<{ id: string }>).map((row) => row.id) : [];
  return { status: r.statusCode, ids };
}

describe("GET /v1/hrms/attendance/face-log — self/manager/HR scope (SEC, biometric data)", () => {
  it("self (bare employee) requesting their OWN employeeId: 200, sees only their own log", async () => {
    const { status, ids } = await faceLog(REPORT1_ID, report1Token);
    expect(status).toBe(200);
    expect(ids).toEqual([REPORT1_LOG_ID]);
  });

  it("REPRODUCTION: a bare employee requesting a DIFFERENT employee's id is now blocked -- this was the live IDOR (any authenticated caller could read anyone's face-verification history)", async () => {
    const { status } = await faceLog(OUTSIDER_ID, report1Token);
    expect(status).toBe(403);
  });

  it("manager requesting a real direct report's employeeId: 200, scoped to just that report's log", async () => {
    const { status, ids } = await faceLog(REPORT1_ID, managerToken);
    expect(status).toBe(200);
    expect(ids).toEqual([REPORT1_LOG_ID]);
  });

  it("manager requesting their OWN employeeId: 200 -- must not be locked out of their own data", async () => {
    const { status, ids } = await faceLog(MANAGER_ID, managerToken);
    expect(status).toBe(200);
    expect(ids).toEqual([MANAGER_LOG_ID]);
  });

  it("manager requesting the OUTSIDER's employeeId (not a direct report): denied, not substituted (IDOR closed for managers too)", async () => {
    const { status } = await faceLog(OUTSIDER_ID, managerToken);
    expect(status).toBe(403);
  });

  it("manager with NO resolvable employee link: denied even for a real employee's id (fails closed, never falls through to unfiltered)", async () => {
    const { status } = await faceLog(REPORT1_ID, unlinkedMgrToken);
    expect(status).toBe(403);
  });

  it("HR sees a report's face-log -- broader access preserved, unaffected by the self/manager scoping fix", async () => {
    const { status, ids } = await faceLog(REPORT1_ID, hrToken);
    expect(status).toBe(200);
    expect(ids).toEqual([REPORT1_LOG_ID]);
  });

  it("HR sees the OUTSIDER's face-log too -- tenant-wide HR access is unaffected by the self/manager scoping fix", async () => {
    const { status, ids } = await faceLog(OUTSIDER_ID, hrToken);
    expect(status).toBe(200);
    expect(ids).toEqual([OUTSIDER_LOG_ID]);
  });

  it("the outsider (bare employee) can still see their own log -- the fix does not accidentally block legitimate self-access", async () => {
    const { status, ids } = await faceLog(OUTSIDER_ID, outsiderToken);
    expect(status).toBe(200);
    expect(ids).toEqual([OUTSIDER_LOG_ID]);
  });
});
