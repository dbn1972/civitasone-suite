/**
 * W1 SF-16 — employee-readable per-employee GETs, real-DB, no mocks.
 * An employee asking for someone else's record gets their own / 403 / 404;
 * a manager is limited to self + direct reports; HR/finance keep access.
 *   - GET /employees/:id/ltc-claims, /ltc-claims/:claimId (+ cea twins)
 *   - GET /attempts/:id
 *   - GET /sessions/:id/attendance
 *   - GET /attendance (manager scope)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "facade00-5f16-4000-8000-000000000b01";
const SEED = "facade00-5f16-4000-8000-0000000001ff";
const id = (n: number): string => `facade00-5f16-4000-8000-00000000${String(n).padStart(4, "0")}`;
const DEPT = id(0x1d1), DESIG = id(0x1d2);
const MGR = id(0x1e1), REPORT = id(0x1e2), OTHER = id(0x1e3), PEER = id(0x1e4);
const SUB = { mgr: "sf16b-mgr", report: "sf16b-report", other: "sf16b-other", hr: "sf16b-hr", fin: "sf16b-fin", unlinked: "sf16b-unlinked" };
const LTC = id(0x2a1), LTC_OTHER = id(0x2a2), CEA = id(0x2b1), CEA_OTHER = id(0x2b2);
const BANK = id(0x3a1), ASSESS = id(0x3a2), ATT_REPORT = id(0x3a3), ATT_OTHER = id(0x3a4);
const TRAINING = id(0x4a1), SESSION = id(0x4a2);

const h = (roles: string[], sub: string) => ({ authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "sess-sf16b" }, SECRET)}` });
let app: Awaited<ReturnType<typeof buildApp>>;
const asTenant = <T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> => withRawTenantGuc(sqlClient, TENANT, fn);

async function cleanup(): Promise<void> {
  for (const t of ["training.hrms_session_attendance", "training.hrms_training_sessions", "assessment.attempts", "assessment.assessments", "assessment.question_banks",
    "claims.hrms_ltc_claims", "claims.hrms_cea_claims", "attendance.hrms_attendance", "employee.hrms_employees", "employee.hrms_designations", "employee.hrms_departments"]) {
    await asTenant((tx) => tx.unsafe(`DELETE FROM ${t} WHERE tenant_id = '${TENANT}'`));
  }
}

beforeAll(async () => {
  await cleanup();
  await asTenant((tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT}, ${TENANT}, 'SF16B', 'SF16B Dept', ${SEED}, ${SEED})`);
  await asTenant((tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by) VALUES (${DESIG}, ${TENANT}, 'SF16B', 'SF16B Desig', ${SEED}, ${SEED})`);
  for (const [eid, no, sub, mgr] of [[MGR, "B-M", SUB.mgr, null], [REPORT, "B-R", SUB.report, MGR], [OTHER, "B-O", SUB.other, null], [PEER, "B-P", null, null]] as const) {
    await asTenant((tx) => tx`INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, user_ref, manager_id, created_by, updated_by)
      VALUES (${eid}, ${TENANT}, ${no}, ${"SF16B " + no}, ${DEPT}, ${DESIG}, '2020-01-01', ${sub}, ${mgr}, ${SEED}, ${SEED})`);
  }
  for (const [cid, emp] of [[LTC, REPORT], [LTC_OTHER, OTHER]] as const) {
    await asTenant((tx) => tx`INSERT INTO claims.hrms_ltc_claims (id, tenant_id, employee_id, block_year, ltc_type, journey_from, journey_to, travel_date, claimed_fare_minor, entitlement_minor, created_by, updated_by)
      VALUES (${cid}, ${TENANT}, ${emp}, '2022-25', 'hometown', 'A', 'B', '2025-01-01', 1000, 1000, ${SEED}, ${SEED})`);
  }
  for (const [cid, emp] of [[CEA, REPORT], [CEA_OTHER, OTHER]] as const) {
    await asTenant((tx) => tx`INSERT INTO claims.hrms_cea_claims (id, tenant_id, employee_id, academic_year, child_name, child_ref, claim_kind, claimed_amount_minor, annual_cap_minor, created_by, updated_by)
      VALUES (${cid}, ${TENANT}, ${emp}, '2025-26', 'Child', 'c1', 'tuition', 500, 1000, ${SEED}, ${SEED})`);
  }
  await asTenant((tx) => tx`INSERT INTO assessment.question_banks (id, tenant_id, title, created_by) VALUES (${BANK}, ${TENANT}, 'b', ${SEED})`);
  await asTenant((tx) => tx`INSERT INTO assessment.assessments (id, tenant_id, title, bank_id, passing_score, created_by) VALUES (${ASSESS}, ${TENANT}, 'a', ${BANK}, 50, ${SEED})`);
  for (const [aid, emp] of [[ATT_REPORT, REPORT], [ATT_OTHER, OTHER]] as const) {
    await asTenant((tx) => tx`INSERT INTO assessment.attempts (id, tenant_id, assessment_id, employee_id, attempt_no) VALUES (${aid}, ${TENANT}, ${ASSESS}, ${emp}, 1)`);
  }
  await asTenant((tx) => tx`INSERT INTO training.hrms_training_sessions (id, tenant_id, training_id, title, session_date, created_by, updated_by) VALUES (${SESSION}, ${TENANT}, ${TRAINING}, 's', '2026-01-01', ${SEED}, ${SEED})`);
  for (const emp of [REPORT, OTHER]) {
    await asTenant((tx) => tx`INSERT INTO training.hrms_session_attendance (tenant_id, session_id, employee_id, status, marked_by) VALUES (${TENANT}, ${SESSION}, ${emp}, 'present', ${SEED})`);
  }
  for (const emp of [MGR, REPORT, OTHER]) {
    await asTenant((tx) => tx`INSERT INTO attendance.hrms_attendance (id, tenant_id, employee_id, attendance_date, status, created_by, updated_by) VALUES (gen_random_uuid(), ${TENANT}, ${emp}, '2026-11-01', 'present', ${SEED}, ${SEED})`);
  }
  app = await buildApp();
});
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

const get = (url: string, roles: string[], sub: string) => app.inject({ method: "GET", url, headers: h(roles, sub) });

describe.each([["ltc", LTC, LTC_OTHER], ["cea", CEA, CEA_OTHER]] as const)("%s claims — self-scope", (kind, own, others) => {
  const list = (e: string) => `/v1/hrms/employees/${e}/${kind}-claims`;
  const one = (c: string) => `/v1/hrms/${kind}-claims/${c}`;
  it("employee: own list ok, a colleague's list 403", async () => {
    expect((await get(list(REPORT), ["employee"], SUB.report)).statusCode).toBe(200);
    expect((await get(list(OTHER), ["employee"], SUB.report)).statusCode).toBe(403);
  });
  it("employee: own claim ok, a colleague's claim 404 (not enumerable)", async () => {
    expect((await get(one(own), ["employee"], SUB.report)).statusCode).toBe(200);
    expect((await get(one(others), ["employee"], SUB.report)).statusCode).toBe(404);
  });
  it("unlinked employee fails closed", async () => {
    expect((await get(list(REPORT), ["employee"], SUB.unlinked)).statusCode).toBe(403);
    expect((await get(one(own), ["employee"], SUB.unlinked)).statusCode).toBe(404);
  });
  it("manager: direct report ok, non-report 403/404", async () => {
    expect((await get(list(REPORT), ["manager"], SUB.mgr)).statusCode).toBe(200);
    expect((await get(one(own), ["manager"], SUB.mgr)).statusCode).toBe(200);
    expect((await get(list(OTHER), ["manager"], SUB.mgr)).statusCode).toBe(403);
    expect((await get(one(others), ["manager"], SUB.mgr)).statusCode).toBe(404);
  });
  it("HR and finance keep access to anyone's claims", async () => {
    expect((await get(list(OTHER), ["hr_admin"], SUB.hr)).statusCode).toBe(200);
    expect((await get(one(others), ["finance_officer"], SUB.fin)).statusCode).toBe(200);
  });
});

describe("GET /v1/hrms/attempts/:id", () => {
  it("employee reads own attempt, 404 on a colleague's", async () => {
    expect((await get(`/v1/hrms/attempts/${ATT_REPORT}`, ["employee"], SUB.report)).statusCode).toBe(200);
    expect((await get(`/v1/hrms/attempts/${ATT_OTHER}`, ["employee"], SUB.report)).statusCode).toBe(404);
  });
  it("manager: report ok, non-report 404; HR any", async () => {
    expect((await get(`/v1/hrms/attempts/${ATT_REPORT}`, ["manager"], SUB.mgr)).statusCode).toBe(200);
    expect((await get(`/v1/hrms/attempts/${ATT_OTHER}`, ["manager"], SUB.mgr)).statusCode).toBe(404);
    expect((await get(`/v1/hrms/attempts/${ATT_OTHER}`, ["hr_admin"], SUB.hr)).statusCode).toBe(200);
  });
});

describe("GET /v1/hrms/sessions/:id/attendance", () => {
  it("bare employee sees only their own row; unlinked sees none; HR sees all", async () => {
    const own = (await get(`/v1/hrms/sessions/${SESSION}/attendance`, ["employee"], SUB.report)).json();
    expect(own.records.map((r: { employeeId: string }) => r.employeeId)).toEqual([REPORT]);
    expect((await get(`/v1/hrms/sessions/${SESSION}/attendance`, ["employee"], SUB.unlinked)).json().records).toEqual([]);
    expect((await get(`/v1/hrms/sessions/${SESSION}/attendance`, ["hr_admin"], SUB.hr)).json().records.length).toBe(2);
  });
});

describe("GET /v1/hrms/attendance — manager scope", () => {
  it("manager list holds only self + direct reports; HR sees all three", async () => {
    const m = (await get(`/v1/hrms/attendance`, ["manager"], SUB.mgr)).json() as Array<{ employeeId: string }>;
    const ids = (Array.isArray(m) ? m : (m as unknown as { data: typeof m }).data).map((r) => r.employeeId).sort();
    expect(ids).toEqual([MGR, REPORT].sort());
    const hr = (await get(`/v1/hrms/attendance`, ["hr_admin"], SUB.hr)).json() as Array<{ employeeId: string }>;
    expect((Array.isArray(hr) ? hr : (hr as unknown as { data: typeof hr }).data).length).toBe(3);
  });
  it("manager asking for a non-report by empId+month gets nothing", async () => {
    const r = await get(`/v1/hrms/attendance?empId=${OTHER}&month=2026-11`, ["manager"], SUB.mgr);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual([]);
    const own = await get(`/v1/hrms/attendance?empId=${REPORT}&month=2026-11`, ["manager"], SUB.mgr);
    expect((own.json() as unknown[]).length).toBe(1);
  });
  it("bare employee (no HR/manager role) is rejected 403 for any empId; the route-level empId guard is defence in depth", async () => {
    for (const q of [`?empId=${OTHER}&month=2026-11`, `?empId=${OTHER}`, `?empId=${REPORT}&month=2026-11`, ""]) {
      expect((await get(`/v1/hrms/attendance${q}`, ["employee"], SUB.report)).statusCode).toBe(403);
    }
  });
  it("manager: empId outside scope (no month) gets nothing; scope is applied before the limit (limit=1, 3 tenant rows)", async () => {
    expect((await get(`/v1/hrms/attendance?empId=${OTHER}`, ["manager"], SUB.mgr)).json()).toEqual([]);
    const r = (await get(`/v1/hrms/attendance?limit=1`, ["manager"], SUB.mgr)).json() as Array<{ employeeId: string }>;
    expect(r.length).toBe(1);
    expect([MGR, REPORT]).toContain(r[0]!.employeeId);
    const rr = (await get(`/v1/hrms/attendance?limit=1&empId=${REPORT}`, ["manager"], SUB.mgr)).json() as Array<{ employeeId: string }>;
    expect(rr.map((x) => x.employeeId)).toEqual([REPORT]);
  });
});
