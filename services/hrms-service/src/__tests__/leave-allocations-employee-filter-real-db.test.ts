/**
 * FQ14 (UAT, out-of-scope finding fixed alongside): GET /v1/hrms/leave-allocations
 * ignored ?employeeId=, so an HR caller filtering to one employee got every
 * employee's allocations. Real Fastify + real Postgres (RLS).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

vi.mock("../shared/identity-client.js", () => ({
  fetchVerifiedActorEmail: vi.fn(async () => undefined),
  fetchUserRoleKeys: vi.fn(async () => undefined),
  fetchUserStatus: vi.fn(async () => undefined),
}));

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "f0142000-0000-4000-8000-0000000000a1";
const SEED   = "f0142000-0000-4000-8000-0000000000ff";
const DEPT   = "f0142000-0000-4000-8000-0000000000d1";
const DESIG  = "f0142000-0000-4000-8000-0000000000d2";
const LT     = "f0142000-0000-4000-8000-0000000000c1";
const EMP_1  = "f0142000-0000-4000-8000-0000000000e1";
const EMP_2  = "f0142000-0000-4000-8000-0000000000e2";
const SUB_1  = "f0142000-0000-4000-8000-00000000a001";

const hr = { authorization: `Bearer ${signToken({ sub: SEED, tid: TENANT, roles: ["hr_admin"], sid: "s-fq14l" }, SECRET)}` };
const emp1 = { authorization: `Bearer ${signToken({ sub: SUB_1, tid: TENANT, roles: ["employee"], sid: "s-fq14l1" }, SECRET)}` };

let app: Awaited<ReturnType<typeof buildApp>>;
const asTenant = <T>(fn: (tx: typeof sqlClient) => Promise<T>) => withRawTenantGuc(sqlClient, TENANT, fn);

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM leave.hrms_leave_allocs WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM leave.hrms_leave_types WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

beforeAll(async () => {
  await cleanup();
  await asTenant((tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT}, ${TENANT}, 'FQ14L', 'FQ14L', ${SEED}, ${SEED})`);
  await asTenant((tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by) VALUES (${DESIG}, ${TENANT}, 'FQ14L', 'FQ14L', ${SEED}, ${SEED})`);
  for (const [id, no, ref] of [[EMP_1, "FQ14L1", SUB_1], [EMP_2, "FQ14L2", null]] as const) {
    await asTenant((tx) => tx`
      INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, status, user_ref, created_by, updated_by)
      VALUES (${id}, ${TENANT}, ${no}, ${"Emp " + no}, ${DEPT}, ${DESIG}, '2022-01-01', 'confirmed', ${ref}, ${SEED}, ${SEED})`);
  }
  await asTenant((tx) => tx`INSERT INTO leave.hrms_leave_types (id, tenant_id, code, name, created_by, updated_by) VALUES (${LT}, ${TENANT}, 'FQ14L', 'FQ14 Leave', ${SEED}, ${SEED})`);
  for (const [id, e] of [["f0142000-0000-4000-8000-0000000000b1", EMP_1], ["f0142000-0000-4000-8000-0000000000b2", EMP_2]] as const) {
    await asTenant((tx) => tx`
      INSERT INTO leave.hrms_leave_allocs (id, tenant_id, employee_id, leave_type_id, fy, total_days, balance_days, created_by, updated_by)
      VALUES (${id}, ${TENANT}, ${e}, ${LT}, '2026-27', 12, 12, ${SEED}, ${SEED})`);
  }
  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
});

const ids = (res: { json: () => { data: Array<{ employeeId: string }> } }) => res.json().data.map((a) => a.employeeId).sort();

describe("GET /v1/hrms/leave-allocations?employeeId=", () => {
  it("HR with employeeId gets only that employee's allocations", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/hrms/leave-allocations?employeeId=${EMP_2}`, headers: hr });
    expect(res.statusCode).toBe(200);
    expect(ids(res)).toEqual([EMP_2]);
  });

  it("HR without employeeId still gets the whole tenant", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/leave-allocations", headers: hr });
    expect(ids(res)).toEqual([EMP_1, EMP_2].sort());
  });

  it("a bare employee asking for a colleague still gets only their own", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/hrms/leave-allocations?employeeId=${EMP_2}`, headers: emp1 });
    expect(ids(res)).toEqual([EMP_1]);
  });

  it("400 for a non-uuid employeeId", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/leave-allocations?employeeId=nope", headers: hr });
    expect(res.statusCode).toBe(400);
  });
});
