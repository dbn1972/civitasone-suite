/**
 * GAP-HR-EMPLOYEES-DETAIL-01: GET /v1/hrms/deputation?employeeId= -- the call
 * the employee profile's lifecycle timeline makes -- must return ONLY that
 * employee's deputations (and name each row's employeeId), and reject a
 * non-uuid filter with 400 instead of silently ignoring it. The transfer and
 * promotion list routes have the equivalent coverage in
 * lifecycle-employee-scoping.test.ts; the deputation list had none.
 *
 * Fresh random tenant per run; lifecycle.hrms_deputations is FORCE RLS, so
 * every direct statement runs under withRawTenantGuc (safe on a shared dev DB).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";

// vitest.config.ts injects JWT_SECRET for every suite -- never a literal here (gitleaks scans every commit).
const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const ACTOR = randomUUID();
const DEPT_ID = randomUUID();
const DESIG_ID = randomUUID();
const EMP_A = randomUUID();
const EMP_B = randomUUID();

const token = (roles: string[]) => signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s1" }, SECRET);
const asTenant = <T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> => withRawTenantGuc(sqlClient, TENANT, fn);

async function seedEmployee(employeeId: string, employeeNo: string) {
  await asTenant((tx) => tx`insert into employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by)
    values
      (${employeeId}::uuid, ${TENANT}::uuid, ${employeeNo}, ${employeeNo}, ${DEPT_ID}::uuid, ${DESIG_ID}::uuid, '2020-01-01', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
}

async function seedDeputation(employeeId: string, org: string) {
  await asTenant((tx) => tx`insert into lifecycle.hrms_deputations
      (id, tenant_id, employee_id, parent_cadre, parent_department_id, borrowing_department, tenure_from, tenure_to, status, created_by, updated_by)
    values
      (${randomUUID()}::uuid, ${TENANT}::uuid, ${employeeId}::uuid, 'IAS', ${DEPT_ID}::uuid, ${org}, '2026-01-01', '2027-01-01', 'active', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await asTenant((tx) => tx`insert into employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
    values (${DEPT_ID}::uuid, ${TENANT}::uuid, 'DEPSCOPE', 'Deputation Scoping Dept', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
  await asTenant((tx) => tx`insert into employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by)
    values (${DESIG_ID}::uuid, ${TENANT}::uuid, 'DEPSCOPE', 'Deputation Scoping Designation', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
  await seedEmployee(EMP_A, "DEPSCOPE-001");
  await seedEmployee(EMP_B, "DEPSCOPE-002");
  await seedDeputation(EMP_A, "Ministry of Finance");
  await seedDeputation(EMP_B, "Ministry of Defence");
});

afterAll(async () => {
  await asTenant((tx) => tx`delete from lifecycle.hrms_deputations where tenant_id = ${TENANT}::uuid`);
  await asTenant((tx) => tx`delete from employee.hrms_employees where tenant_id = ${TENANT}::uuid`);
  await asTenant((tx) => tx`delete from employee.hrms_designations where tenant_id = ${TENANT}::uuid`);
  await asTenant((tx) => tx`delete from employee.hrms_departments where tenant_id = ${TENANT}::uuid`);
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/deputation -- ?employeeId= scoping", () => {
  it("returns only the requested employee's deputations, each naming its employeeId", async () => {
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/deputation?employeeId=${EMP_A}`,
      headers: { authorization: `Bearer ${token(["hr_admin"])}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { data: Array<{ employeeId: string; deputationOrg: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.employeeId).toBe(EMP_A);
    expect(body.data[0]!.deputationOrg).toBe("Ministry of Finance");
    expect(JSON.stringify(body)).not.toContain("Ministry of Defence");
  });

  it("still lists every deputation tenant-wide when employeeId is omitted (register-page callers)", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/deputation",
      headers: { authorization: `Bearer ${token(["hr_admin"])}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { data: Array<{ employeeId: string }> };
    const ids = new Set(body.data.map((row) => row.employeeId));
    expect(ids.has(EMP_A)).toBe(true);
    expect(ids.has(EMP_B)).toBe(true);
  });

  it("rejects a non-uuid employeeId with 400, not a silent no-op filter", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/deputation?employeeId=not-a-uuid",
      headers: { authorization: `Bearer ${token(["hr_admin"])}` },
    });
    expect(r.statusCode).toBe(400);
  });

  it("keeps the HR-only role gate: a manager gets 403, not another employee's deputation", async () => {
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/deputation?employeeId=${EMP_A}`,
      headers: { authorization: `Bearer ${token(["manager"])}` },
    });
    expect(r.statusCode).toBe(403);
  });
});
