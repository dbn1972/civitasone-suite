/**
 * GAP-HR-EMPLOYEES-DETAIL-EDIT-04 -- basic pay is not editable through the
 * generic PATCH /v1/hrms/employees/:id (no maker-checker / effective date /
 * arrears there). A caller that sends it gets an explicit 400 and nothing is
 * written; the other editable fields are unaffected.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "facade00-a90b-4000-8000-000000000a9b";
const SEED = "facade00-a90b-4000-8000-0000000000ff";
const DEPT = "facade00-a90b-4000-8000-0000000000d1";
const DESIG = "facade00-a90b-4000-8000-0000000000d2";
const EMP = "facade00-a90b-4000-8000-0000000000e1";
const hr = { authorization: `Bearer ${signToken({ sub: "facade00-a90b-4000-8000-0000000000e9", tid: TENANT, roles: ["hr_officer"], sid: "s" }, SECRET)}` };

let app: Awaited<ReturnType<typeof buildApp>>;
const asTenant = <T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> => withRawTenantGuc(sqlClient, TENANT, fn);

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}
beforeAll(async () => {
  await cleanup();
  await asTenant((tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT}, ${TENANT}, 'BP', 'BP', ${SEED}, ${SEED})`);
  await asTenant((tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by) VALUES (${DESIG}, ${TENANT}, 'BP', 'BP', ${SEED}, ${SEED})`);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, employee_type, basic_minor, created_by, updated_by)
    VALUES (${EMP}, ${TENANT}, 'BP-1', 'Basic Pay Test', ${DEPT}, ${DESIG}, '2015-01-01', 'permanent', 4490050, ${SEED}, ${SEED})`);
  app = await buildApp();
});
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

const patch = (payload: unknown) => app.inject({ method: "PATCH", url: `/v1/hrms/employees/${EMP}`, headers: hr, payload: payload as object });

describe("PATCH /v1/hrms/employees/:id basicMinor (GAP-HR-EMPLOYEES-DETAIL-EDIT-04)", () => {
  it("rejects basicMinor with an explicit 400 pointing at salary revision, and the stored basic pay is untouched", async () => {
    const r = await patch({ basicMinor: 9999900 });
    expect(r.statusCode).toBe(400);
    expect(JSON.stringify(r.json())).toMatch(/salary revision/i);
    const row = await asTenant((tx) => tx`SELECT basic_minor::text AS b FROM employee.hrms_employees WHERE id = ${EMP}`);
    expect(row[0]!.b).toBe("4490050");
  });
  it("rejects it even when mixed with otherwise-valid fields (nothing partially applied)", async () => {
    expect((await patch({ mobile: "9876543210", basicMinor: 1 })).statusCode).toBe(400);
  });
  it("other fields still update (202)", async () => {
    expect((await patch({ mobile: "9876543210" })).statusCode).toBe(202);
  });
});
