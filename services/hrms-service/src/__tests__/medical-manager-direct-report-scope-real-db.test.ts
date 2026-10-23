/**
 * Owner decision 2 (2026-10-14, general HR rule): a manager reads only
 * themselves or their direct reports. Real DB, no mocks, for the routes that
 * go through the shared resolveOwnEmployeeIdIfBareEmployee helper:
 *   GET /medical/history, GET /medical/insurance, POST /medical/claims (on
 *   behalf), GET /skills/gap-analysis. HR keeps tenant-wide access.
 * Single-employee medical reads by HR/manager of ANOTHER employee are audited.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc, withTenantScope } from "@civitasone/db";
import { outboxMessages } from "@civitasone/outbox";
import { buildApp } from "../app.js";
import { db, sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { registerMedicalConsumers } from "../modules/medical/consumer.js";

registerMedicalConsumers(queue);
const drain = (): Promise<void> => (queue as unknown as { drain: () => Promise<void> }).drain();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr"; // gitleaks:allow
const TENANT     = "facade00-5c0e-4000-8000-000000000d01";
const SEED_ACTOR = "facade00-5c0e-4000-8000-0000000000ff";
const DEPT_ID    = "facade00-5c0e-4000-8000-0000000000d1";
const DESIG_ID   = "facade00-5c0e-4000-8000-0000000000d2";
const EMP_M = "facade00-5c0e-4000-8000-0000000000e1"; const M_SUB  = "facade00-5c0e-4000-8000-0000000000a1";
const EMP_R = "facade00-5c0e-4000-8000-0000000000e2";
const EMP_O = "facade00-5c0e-4000-8000-0000000000e3";
const HR_SUB = "facade00-5c0e-4000-8000-0000000000a2";

const bearer = (roles: string[], sub: string): { authorization: string; "content-type": string } =>
  ({ authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "sess-med-scope" }, SECRET)}`, "content-type": "application/json" });
const MGR = bearer(["manager"], M_SUB);
const HR  = bearer(["hr_admin"], HR_SUB);

let app: Awaited<ReturnType<typeof buildApp>>;
const asTenant = <T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> => withRawTenantGuc(sqlClient, TENANT, fn);

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM medical.hrms_medical_claims WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

async function medicalReads(target: string, view: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await withTenantScope(db, TENANT, async (tx: any) =>
    tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)));
  return (rows as Array<{ actorId: string; payload: Record<string, unknown> }>).filter((r) =>
    r.payload?.resourceType === "medical_employee_record" && r.payload?.resourceId === target && r.payload?.view === view);
}

beforeAll(async () => {
  await cleanup();
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DEPT_ID}, ${TENANT}, 'MSCOPE', 'Med Scope Dept', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DESIG_ID}, ${TENANT}, 'MSCOPE', 'Med Scope Desig', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  for (const [id, no, name, sub, mgr] of [
    [EMP_M, "MS-M", "Med Scope Manager", M_SUB, null],
    [EMP_R, "MS-R", "Med Scope Report", null, EMP_M],
    [EMP_O, "MS-O", "Med Scope Other", null, null],
  ] as const) {
    await asTenant((tx) => tx`
      INSERT INTO employee.hrms_employees
        (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, user_ref, manager_id, created_by, updated_by)
      VALUES (${id}, ${TENANT}, ${no}, ${name}, ${DEPT_ID}, ${DESIG_ID}, '2020-01-01', ${sub}, ${mgr}, ${SEED_ACTOR}, ${SEED_ACTOR})`);
  }
  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

const get = (url: string, headers: Record<string, string>) => app.inject({ method: "GET", url, headers });
const claim = (employeeId: string, headers: Record<string, string>) => app.inject({
  method: "POST", url: "/v1/hrms/medical/claims", headers,
  body: JSON.stringify({ employeeId, claimType: "outdoor", amountMinor: 1000, hospitalName: "H", diagnosis: "d", documents: [] }),
});

describe("medical history / insurance — manager limited to self + direct reports", () => {
  it("history: non-report 403, direct report 200, self 200, HR 200", async () => {
    expect((await get(`/v1/hrms/medical/history?employeeId=${EMP_O}`, MGR)).statusCode).toBe(403);
    expect((await get(`/v1/hrms/medical/history?employeeId=${EMP_R}`, MGR)).statusCode).toBe(200);
    expect((await get(`/v1/hrms/medical/history?employeeId=${EMP_M}`, MGR)).statusCode).toBe(200);
    expect((await get(`/v1/hrms/medical/history?employeeId=${EMP_O}`, HR)).statusCode).toBe(200);
  });

  it("insurance: a manager asking for a non-report is refused with 403", async () => {
    expect((await get(`/v1/hrms/medical/insurance?employeeId=${EMP_O}`, MGR)).statusCode).toBe(403);
  });

  it("POST claims on behalf: manager filing for a non-report is 403; for a direct report 201", async () => {
    expect((await claim(EMP_O, MGR)).statusCode).toBe(403);
    expect((await claim(EMP_R, MGR)).statusCode).toBe(201);
  });
});

describe("skills gap-analysis — manager limited to self + direct reports", () => {
  it("non-report 403, direct report 200, HR 200", async () => {
    expect((await get(`/v1/hrms/skills/gap-analysis?employeeId=${EMP_O}`, MGR)).statusCode).toBe(403);
    expect((await get(`/v1/hrms/skills/gap-analysis?employeeId=${EMP_R}`, MGR)).statusCode).toBe(200);
    expect((await get(`/v1/hrms/skills/gap-analysis?employeeId=${EMP_O}`, HR)).statusCode).toBe(200);
  });
});

describe("medical single-employee reads — audit", () => {
  it("manager reading a report's history and HR reading another's are audited; own record and refused reads are not", async () => {
    await drain();
    const [r0, o0, m0] = [(await medicalReads(EMP_R, "history")).length, (await medicalReads(EMP_O, "history")).length, (await medicalReads(EMP_M, "history")).length];
    await get(`/v1/hrms/medical/history?employeeId=${EMP_R}`, MGR);
    await get(`/v1/hrms/medical/history?employeeId=${EMP_O}`, MGR); // refused: 403, no audit
    await get(`/v1/hrms/medical/history?employeeId=${EMP_O}`, HR);
    await get(`/v1/hrms/medical/history?employeeId=${EMP_M}`, MGR); // own: no audit
    await drain();
    const r = await medicalReads(EMP_R, "history");
    expect(r.length).toBe(r0 + 1);
    expect(r[r.length - 1]!.actorId).toBe(M_SUB);
    const o = await medicalReads(EMP_O, "history");
    expect(o.length).toBe(o0 + 1);
    expect(o[o.length - 1]!.actorId).toBe(HR_SUB);
    expect((await medicalReads(EMP_M, "history")).length).toBe(m0);
  });
});
