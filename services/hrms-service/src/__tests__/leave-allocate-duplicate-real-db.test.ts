/**
 * GAP-HR-LEAVE-ALLOCATE-02 — real-DB round-trip regression test.
 *
 * No synchronous check existed for an existing allocation (same employee +
 * leave type + FY), and no DB constraint either — a double-submit could
 * create two hrms_leave_allocs rows for the same combination. Two layers
 * now guard this: commands.allocateLeave's synchronous 409 pre-check (this
 * test's HTTP-level cases), and a unique index + onConflictDoNothing in
 * repo.insertLeaveAlloc (migration 0163; this test's direct-repo-call case,
 * simulating the race the pre-check alone cannot close — two callers both
 * passing the pre-check before either's INSERT commits).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { registerLeaveConsumers } from "../modules/leave/consumer.js";

// buildApp() registers routes only, not consumers (each runs in a separate
// worker process in production) — without this, commands.allocateLeave's
// synchronous pre-check (repo.findAllocByEmpAndType) never finds a row for
// even a genuine duplicate, because nothing ever processed the FIRST
// allocation's queued INSERT. Same convention as medical-claims-real-db.test.ts.
registerLeaveConsumers(queue);

async function drainQueue(): Promise<void> {
  await (queue as unknown as { drain: () => Promise<void> }).drain();
}

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "facade00-a110-4000-8000-000000000a11";
const SEED_ACTOR = "facade00-a110-4000-8000-0000000000ff";
const DEPT_ID = "facade00-a110-4000-8000-0000000000d1";
const DESIG_ID = "facade00-a110-4000-8000-0000000000d2";
const EMPLOYEE_ID = "facade00-a110-4000-8000-0000000000e1";
const LEAVE_TYPE_ID = "facade00-a110-4000-8000-0000000000ca";

function tok(roles: string[]) {
  return signToken({ sub: "facade00-a110-4000-8000-0000000000a9", tid: TENANT, roles, sid: "sess-allocate-dup-test" }, SECRET);
}
const hrAdminToken = tok(["hr_admin"]);

let app: Awaited<ReturnType<typeof buildApp>>;

function asTenant<T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, TENANT, fn);
}

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM leave.hrms_leave_allocs WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM leave.hrms_leave_types WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

beforeAll(async () => {
  await cleanup();
  await asTenant((tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT_ID}, ${TENANT}, 'ALDUP', 'Allocate Dup Test Dept', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by) VALUES (${DESIG_ID}, ${TENANT}, 'ALDUP', 'Allocate Dup Test Designation', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by)
    VALUES (${EMPLOYEE_ID}, ${TENANT}, 'ALDUP-001', 'Allocate Dup Test Employee', ${DEPT_ID}, ${DESIG_ID}, '2020-01-01', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`INSERT INTO leave.hrms_leave_types (id, tenant_id, code, name, created_by, updated_by) VALUES (${LEAVE_TYPE_ID}, ${TENANT}, 'ALDUP', 'Allocate Dup Test Type', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("leave allocation duplicate prevention", () => {
  it("first allocation for (employee, type, FY) succeeds (202); a second for the SAME combo is rejected 409 ALLOCATION_EXISTS, and only one row exists", async () => {
    const first = await app.inject({
      method: "POST", url: "/v1/hrms/leave-allocations",
      headers: { authorization: `Bearer ${hrAdminToken}` },
      payload: { employeeId: EMPLOYEE_ID, leaveTypeId: LEAVE_TYPE_ID, fy: "2026-27", totalDays: 30 },
    });
    expect(first.statusCode).toBe(202);
    await drainQueue(); // let the consumer actually insert the row before the "duplicate" check below can see it

    const second = await app.inject({
      method: "POST", url: "/v1/hrms/leave-allocations",
      headers: { authorization: `Bearer ${hrAdminToken}` },
      payload: { employeeId: EMPLOYEE_ID, leaveTypeId: LEAVE_TYPE_ID, fy: "2026-27", totalDays: 15 },
    });
    expect(second.statusCode).toBe(409);
    expect(JSON.parse(second.body).code).toBe("ALLOCATION_EXISTS");

    // A DIFFERENT fy for the same employee+type is a distinct combination —
    // must still be allowed (the constraint is per-FY, not per-employee+type).
    const differentFy = await app.inject({
      method: "POST", url: "/v1/hrms/leave-allocations",
      headers: { authorization: `Bearer ${hrAdminToken}` },
      payload: { employeeId: EMPLOYEE_ID, leaveTypeId: LEAVE_TYPE_ID, fy: "2027-28", totalDays: 30 },
    });
    expect(differentFy.statusCode).toBe(202);
    await drainQueue();

    const rows = await asTenant((tx) => tx`SELECT fy FROM leave.hrms_leave_allocs WHERE tenant_id = ${TENANT} AND employee_id = ${EMPLOYEE_ID} AND leave_type_id = ${LEAVE_TYPE_ID} ORDER BY fy`);
    expect(rows.map((r) => r.fy)).toEqual(["2026-27", "2027-28"]);
  });

  it("migration 0163's unique index actually exists and rejects a raw duplicate insert at the database level — the constraint commands.ts's pre-check and repo.insertLeaveAlloc's onConflictDoNothing both rely on", async () => {
    const raceFy = "2028-29";
    await asTenant((tx) => tx`
      INSERT INTO leave.hrms_leave_allocs (id, tenant_id, employee_id, leave_type_id, fy, total_days, balance_days, created_by, updated_by)
      VALUES ('facade00-a110-4000-8000-0000000000b1', ${TENANT}, ${EMPLOYEE_ID}, ${LEAVE_TYPE_ID}, ${raceFy}, 30, 30, ${SEED_ACTOR}, ${SEED_ACTOR})
    `);
    await expect(
      asTenant((tx) => tx`
        INSERT INTO leave.hrms_leave_allocs (id, tenant_id, employee_id, leave_type_id, fy, total_days, balance_days, created_by, updated_by)
        VALUES ('facade00-a110-4000-8000-0000000000b2', ${TENANT}, ${EMPLOYEE_ID}, ${LEAVE_TYPE_ID}, ${raceFy}, 99, 99, ${SEED_ACTOR}, ${SEED_ACTOR})
      `),
    ).rejects.toThrow(/duplicate key value violates unique constraint/i);

    const rows = await asTenant((tx) => tx`SELECT id, total_days FROM leave.hrms_leave_allocs WHERE tenant_id = ${TENANT} AND employee_id = ${EMPLOYEE_ID} AND leave_type_id = ${LEAVE_TYPE_ID} AND fy = ${raceFy}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.total_days).toBe(30);
  });
});
