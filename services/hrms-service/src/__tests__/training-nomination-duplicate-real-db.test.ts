/**
 * GAP-HR-TRAINING-01 -- POST /v1/hrms/nominations refuses a duplicate synchronously, real DB.
 *
 * hrms_nominations is unique on (tenant, training, employee). A second
 * nomination for the same pair used to be answered 202 and then fail silently
 * inside the queue consumer. HR can now nominate colleagues from the programme
 * page, so the repeat is a realistic mistake: it must be a 409 the user sees.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "";
const TENANT = "facade00-a04e-4000-8000-000000000061";
const SEED = randomUUID();
const DEPT = randomUUID(), DESIG = randomUUID();
const EMP_A = randomUUID(), EMP_B = randomUUID();
const USER_A = randomUUID(); // EMP_A's login (JWT sub) -- a different id space from EMP_A, as in production
const TRAINING = randomUUID();

const tok = (roles: string[], sub = randomUUID()) => signToken({ sub, tid: TENANT, roles, sid: "sess-nomination-dup" }, SECRET);
const hr = { authorization: `Bearer ${tok(["hr_officer"])}` };

let app: Awaited<ReturnType<typeof buildApp>>;
const asTenant = <T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> => withRawTenantGuc(sqlClient, TENANT, fn);
async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM training.hrms_nominations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM training.hrms_trainings WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

beforeAll(async () => {
  await cleanup();
  await asTenant((tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT}, ${TENANT}, 'ND', 'Nom Dept', ${SEED}, ${SEED})`);
  await asTenant((tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by) VALUES (${DESIG}, ${TENANT}, 'ND-D', 'Nom Desig', ${SEED}, ${SEED})`);
  for (const [id, no, ref] of [[EMP_A, "ND-001", USER_A], [EMP_B, "ND-002", randomUUID()]] as const) {
    await asTenant((tx) => tx`
      INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, employee_type, user_ref, created_by, updated_by)
      VALUES (${id}, ${TENANT}, ${no}, ${no}, ${DEPT}, ${DESIG}, '2015-01-01', 'permanent', ${ref}, ${SEED}, ${SEED})`);
  }
  await asTenant((tx) => tx`INSERT INTO training.hrms_trainings (id, tenant_id, title, from_date, to_date, created_by, updated_by) VALUES (${TRAINING}, ${TENANT}, 'Dup Test', '2099-01-01', '2099-01-02', ${SEED}, ${SEED})`);
  // EMP_A is already nominated for TRAINING.
  await asTenant((tx) => tx`
    INSERT INTO training.hrms_nominations (id, tenant_id, training_id, employee_id, status, created_by, updated_by)
    VALUES (${randomUUID()}, ${TENANT}, ${TRAINING}, ${EMP_A}, 'nominated', ${SEED}, ${SEED})`);
  app = await buildApp();
}, 60_000);
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); }, 60_000);

const nominate = (headers: Record<string, string>, employeeId: string) =>
  app.inject({ method: "POST", url: "/v1/hrms/nominations", headers, payload: { trainingId: TRAINING, employeeId } });

describe("POST /v1/hrms/nominations duplicate guard (GAP-HR-TRAINING-01)", () => {
  it("HR nominating an already-nominated employee is a 409 DUPLICATE_NOMINATION", async () => {
    const r = await nominate(hr, EMP_A);
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("DUPLICATE_NOMINATION");
  });

  it("HR nominating a different employee for the same programme is accepted (202)", async () => {
    const r = await nominate(hr, EMP_B);
    expect(r.statusCode).toBe(202);
  });

  it("an employee re-enrolling themselves (server pins them to their own record) is also a 409", async () => {
    const r = await nominate({ authorization: `Bearer ${tok(["employee"], USER_A)}` }, EMP_B /* ignored: pinned to self */);
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("DUPLICATE_NOMINATION");
  });

  it("an unknown programme / employee is still a 404, checked before the duplicate guard", async () => {
    const noTraining = await app.inject({ method: "POST", url: "/v1/hrms/nominations", headers: hr, payload: { trainingId: randomUUID(), employeeId: EMP_B } });
    expect(noTraining.statusCode).toBe(404);
    const noEmployee = await nominate(hr, randomUUID());
    expect(noEmployee.statusCode).toBe(404);
  });
});
