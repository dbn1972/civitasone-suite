/**
 * W1 owner decision 2 (2026-10-14) -- managers see their direct reports only.
 * Real DB, no mocks. Covers the routes SF-16 flagged as manager-tenant-wide:
 *   - contracts: GET list / detail / employee history / renewals list+detail, POST renew
 *   - ai-predictions: GET attrition-risk, succession
 *   - learning: PATCH enrollments/:id/progress
 * A manager gets self + direct reports; HR stays tenant-wide; an actor with no
 * linked employee record fails closed. List routes filter, detail routes 404,
 * employee-keyed list and writes 403.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "facade00-d2d2-4000-8000-000000000b01";
const SEED = "facade00-d2d2-4000-8000-0000000001ff";
const id = (n: number): string => `facade00-d2d2-4000-8000-00000000${String(n).padStart(4, "0")}`;
const DEPT = id(0x1d1), DESIG_HI = id(0x1d2), DESIG_MID = id(0x1d3);
const MGR = id(0x1e1), REPORT = id(0x1e2), OTHER = id(0x1e3);
const SUB = { mgr: "w1d2-mgr", report: "w1d2-report", other: "w1d2-other", hr: "w1d2-hr", unlinked: "w1d2-unlinked" };
const K_REPORT = id(0x2a1), K_OTHER = id(0x2a2), K_MGR = id(0x2a3);
const R_REPORT = id(0x2b1), R_OTHER = id(0x2b2);
const COURSE = id(0x3a1), E_REPORT = id(0x3a2), E_OTHER = id(0x3a3), E_MGR = id(0x3a4);

const h = (roles: string[], sub: string) => ({ authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "sess-w1d2" }, SECRET)}` });
let app: Awaited<ReturnType<typeof buildApp>>;
const asTenant = <T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> => withRawTenantGuc(sqlClient, TENANT, fn);

async function cleanup(): Promise<void> {
  for (const t of ["contracts.hrms_contract_renewals", "contracts.hrms_contracts", "learning.enrollments", "learning.courses",
    "employee.hrms_employees", "employee.hrms_designations", "employee.hrms_departments"]) {
    await asTenant((tx) => tx.unsafe(`DELETE FROM ${t} WHERE tenant_id = '${TENANT}'`));
  }
}

beforeAll(async () => {
  await cleanup();
  await asTenant((tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT}, ${TENANT}, 'W1D2', 'W1D2 Dept', ${SEED}, ${SEED})`);
  await asTenant((tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, level, created_by, updated_by) VALUES (${DESIG_HI}, ${TENANT}, 'W1D2H', 'W1D2 Senior', 6, ${SEED}, ${SEED})`);
  await asTenant((tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, level, created_by, updated_by) VALUES (${DESIG_MID}, ${TENANT}, 'W1D2M', 'W1D2 Mid', 5, ${SEED}, ${SEED})`);
  for (const [eid, no, sub, mgr, desig] of [[MGR, "D2-M", SUB.mgr, null, DESIG_HI], [REPORT, "D2-R", SUB.report, MGR, DESIG_MID], [OTHER, "D2-O", SUB.other, null, DESIG_MID]] as const) {
    await asTenant((tx) => tx`INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, user_ref, manager_id, created_by, updated_by)
      VALUES (${eid}, ${TENANT}, ${no}, ${"W1D2 " + no}, ${DEPT}, ${desig}, '2026-01-01', ${sub}, ${mgr}, ${SEED}, ${SEED})`);
  }
  for (const [kid, emp, no] of [[K_REPORT, REPORT, "KR"], [K_OTHER, OTHER, "KO"], [K_MGR, MGR, "KM"]] as const) {
    await asTenant((tx) => tx`INSERT INTO contracts.hrms_contracts (id, tenant_id, employee_id, contract_no, start_date, end_date, status, created_by, updated_by)
      VALUES (${kid}, ${TENANT}, ${emp}, ${"W1D2-" + no}, '2026-01-01', '2027-01-01', 'active', ${SEED}, ${SEED})`);
  }
  for (const [rid, kid] of [[R_REPORT, K_REPORT], [R_OTHER, K_OTHER]] as const) {
    await asTenant((tx) => tx`INSERT INTO contracts.hrms_contract_renewals (id, tenant_id, contract_id, renewal_number, initiated_by, new_end_date, original_terms, new_terms, created_by, updated_by)
      VALUES (${rid}, ${TENANT}, ${kid}, 1, ${SEED}, '2028-01-01', '{}'::jsonb, '{}'::jsonb, ${SEED}, ${SEED})`);
  }
  await asTenant((tx) => tx`INSERT INTO learning.courses (id, tenant_id, code, title, category, credit_hours, status, created_by) VALUES (${COURSE}, ${TENANT}, 'W1D2C', 'W1D2 Course', 'general', '1', 'published', ${SEED})`);
  for (const [eid, emp] of [[E_REPORT, REPORT], [E_OTHER, OTHER], [E_MGR, MGR]] as const) {
    await asTenant((tx) => tx`INSERT INTO learning.enrollments (id, tenant_id, course_id, employee_id, status, progress_pct) VALUES (${eid}, ${TENANT}, ${COURSE}, ${emp}, 'in_progress', 20)`);
  }
  app = await buildApp();
});
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

const get = (url: string, roles: string[], sub: string) => app.inject({ method: "GET", url, headers: h(roles, sub) });
const ids = (r: { json: () => unknown }): string[] => ((r.json() as { data: Array<{ id: string }> }).data).map((x) => x.id).sort();

describe("contracts — manager scope", () => {
  it("list: manager sees own + report contracts only; HR sees all three; unlinked sees none", async () => {
    expect(ids(await get("/v1/hrms/contracts", ["manager"], SUB.mgr))).toEqual([K_REPORT, K_MGR].sort());
    expect(ids(await get("/v1/hrms/contracts", ["hr_admin"], SUB.hr))).toEqual([K_REPORT, K_OTHER, K_MGR].sort());
    expect(ids(await get("/v1/hrms/contracts", ["manager"], SUB.unlinked))).toEqual([]);
  });
  it("list: asking for a non-report by employeeId yields nothing for a manager", async () => {
    expect(ids(await get(`/v1/hrms/contracts?employeeId=${OTHER}`, ["manager"], SUB.mgr))).toEqual([]);
    expect(ids(await get(`/v1/hrms/contracts?employeeId=${REPORT}`, ["manager"], SUB.mgr))).toEqual([K_REPORT]);
  });
  it("detail: report 200, non-report 404, HR any 200, unlinked 404", async () => {
    expect((await get(`/v1/hrms/contracts/${K_REPORT}`, ["manager"], SUB.mgr)).statusCode).toBe(200);
    expect((await get(`/v1/hrms/contracts/${K_OTHER}`, ["manager"], SUB.mgr)).statusCode).toBe(404);
    expect((await get(`/v1/hrms/contracts/${K_OTHER}`, ["hr_admin"], SUB.hr)).statusCode).toBe(200);
    expect((await get(`/v1/hrms/contracts/${K_REPORT}`, ["manager"], SUB.unlinked)).statusCode).toBe(404);
  });
  it("employee history: report 200, non-report 403, HR 200, unlinked 403", async () => {
    expect((await get(`/v1/hrms/contracts/employee/${REPORT}/history`, ["manager"], SUB.mgr)).statusCode).toBe(200);
    expect((await get(`/v1/hrms/contracts/employee/${OTHER}/history`, ["manager"], SUB.mgr)).statusCode).toBe(403);
    expect((await get(`/v1/hrms/contracts/employee/${OTHER}/history`, ["hr_admin"], SUB.hr)).statusCode).toBe(200);
    expect((await get(`/v1/hrms/contracts/employee/${REPORT}/history`, ["manager"], SUB.unlinked)).statusCode).toBe(403);
  });
  it("renewals list/detail: manager sees the report's renewal only; HR both; unlinked none", async () => {
    expect(ids(await get("/v1/hrms/contracts/renewals", ["manager"], SUB.mgr))).toEqual([R_REPORT]);
    expect(ids(await get("/v1/hrms/contracts/renewals", ["hr_admin"], SUB.hr))).toEqual([R_REPORT, R_OTHER].sort());
    expect(ids(await get("/v1/hrms/contracts/renewals", ["manager"], SUB.unlinked))).toEqual([]);
    expect((await get(`/v1/hrms/contracts/renewals/${R_REPORT}`, ["manager"], SUB.mgr)).statusCode).toBe(200);
    expect((await get(`/v1/hrms/contracts/renewals/${R_OTHER}`, ["manager"], SUB.mgr)).statusCode).toBe(404);
    expect((await get(`/v1/hrms/contracts/renewals/${R_OTHER}`, ["hr_admin"], SUB.hr)).statusCode).toBe(200);
  });
  it("POST renew: non-report and unlinked manager get 403; a report's contract is allowed", async () => {
    const renew = (k: string, roles: string[], sub: string) =>
      app.inject({ method: "POST", url: `/v1/hrms/contracts/${k}/renew`, headers: h(roles, sub), payload: { newEndDate: "2029-01-01" } });
    expect((await renew(K_OTHER, ["manager"], SUB.mgr)).statusCode).toBe(403);
    expect((await renew(K_REPORT, ["manager"], SUB.unlinked)).statusCode).toBe(403);
    // Allowed: authorization passes (202 queued, or a business-rule status -- never 403/404).
    expect([202, 409, 422]).toContain((await renew(K_REPORT, ["manager"], SUB.mgr)).statusCode);
  });
});

describe("ai-predictions — manager scope", () => {
  const empIds = (r: { json: () => unknown }): string[] => ((r.json() as { data: Array<{ id: string }> }).data).map((x) => x.id);
  it("attrition-risk: manager sees only self + report from this tenant; HR sees all three; unlinked none", async () => {
    const mgr = empIds(await get("/v1/hrms/ai/attrition-risk?minScore=0", ["manager"], SUB.mgr));
    expect(mgr.sort()).toEqual([MGR, REPORT].sort());
    const hr = empIds(await get("/v1/hrms/ai/attrition-risk?minScore=0", ["hr_admin"], SUB.hr));
    expect(hr).toEqual(expect.arrayContaining([MGR, REPORT, OTHER]));
    expect(empIds(await get("/v1/hrms/ai/attrition-risk?minScore=0", ["manager"], SUB.unlinked))).toEqual([]);
  });
  it("succession: a manager's successor list never contains a non-report; HR's does", async () => {
    const cands = (r: { json: () => unknown }): string[] => ((r.json() as { data: Array<{ candidate_id: string }> }).data).map((x) => x.candidate_id);
    const mgr = cands(await get(`/v1/hrms/ai/succession?departmentId=${DEPT}`, ["manager"], SUB.mgr));
    expect(mgr).toContain(REPORT);
    expect(mgr).not.toContain(OTHER);
    expect(cands(await get(`/v1/hrms/ai/succession?departmentId=${DEPT}`, ["hr_admin"], SUB.hr))).toEqual(expect.arrayContaining([REPORT, OTHER]));
    expect(cands(await get(`/v1/hrms/ai/succession?departmentId=${DEPT}`, ["manager"], SUB.unlinked))).toEqual([]);
  });
});

describe("learning PATCH enrollments/:id/progress — manager scope", () => {
  const patch = (e: string, roles: string[], sub: string) =>
    app.inject({ method: "PATCH", url: `/v1/hrms/learning/enrollments/${e}/progress`, headers: h(roles, sub), payload: { percentComplete: 50 } });
  it("manager: report's and own enrolment accepted (202); non-report 403; unlinked 403", async () => {
    expect((await patch(E_REPORT, ["manager"], SUB.mgr)).statusCode).toBe(202);
    expect((await patch(E_MGR, ["manager"], SUB.mgr)).statusCode).toBe(202);
    expect((await patch(E_OTHER, ["manager"], SUB.mgr)).statusCode).toBe(403);
    expect((await patch(E_REPORT, ["manager"], SUB.unlinked)).statusCode).toBe(403);
  });
  it("HR may update anyone's; a bare employee keeps own-only (404 on a colleague's)", async () => {
    expect((await patch(E_OTHER, ["hr_admin"], SUB.hr)).statusCode).toBe(202);
    expect((await patch(E_OTHER, ["employee"], SUB.report)).statusCode).toBe(404);
    expect((await patch(E_REPORT, ["employee"], SUB.report)).statusCode).toBe(202);
  });
});
