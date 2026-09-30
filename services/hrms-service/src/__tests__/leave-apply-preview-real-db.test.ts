/**
 * GAP-HR-LEAVE-APPLY-01 — real-DB round-trip regression test.
 *
 * POST /v1/hrms/leave-requests/preview reuses enforceCcsLeaveRules verbatim
 * (same function the real POST /v1/hrms/leave-requests calls before
 * publishing) — this proves preview and submit can never diverge, and that
 * preview has no side effect (no leave_apps row, no balance debit).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { registerLeaveConsumers } from "../modules/leave/consumer.js";

registerLeaveConsumers(queue);
async function drainQueue(): Promise<void> {
  await (queue as unknown as { drain: () => Promise<void> }).drain();
}

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "facade00-a901-4000-8000-000000000a91";
const SEED_ACTOR = "facade00-a901-4000-8000-0000000000ff";
const DEPT_ID = "facade00-a901-4000-8000-0000000000d1";
const DESIG_ID = "facade00-a901-4000-8000-0000000000d2";
const EMPLOYEE_ID = "facade00-a901-4000-8000-0000000000e1";
const OUTSIDER_ID = "facade00-a901-4000-8000-0000000000e2";
const LEAVE_TYPE_ID = "facade00-a901-4000-8000-0000000000ca";
const ALLOC_ID = "facade00-a901-4000-8000-0000000000a1";

function tok(roles: string[], sub: string) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-apply-preview-test" }, SECRET);
}
const selfToken = tok(["employee"], EMPLOYEE_ID); // sub === the employee's own id resolves via actor-link's userRef fallback path in some setups; see resolveEmployeeForActor
const outsiderToken = tok(["employee"], OUTSIDER_ID);

let app: Awaited<ReturnType<typeof buildApp>>;

function asTenant<T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, TENANT, fn);
}

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM leave.hrms_leave_apps WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM leave.hrms_leave_allocs WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM leave.hrms_leave_types WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

beforeAll(async () => {
  await cleanup();
  await asTenant((tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT_ID}, ${TENANT}, 'APPV', 'Apply Preview Test Dept', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by) VALUES (${DESIG_ID}, ${TENANT}, 'APPV', 'Apply Preview Test Designation', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, employee_type, user_ref, created_by, updated_by)
    VALUES (${EMPLOYEE_ID}, ${TENANT}, 'APPV-001', 'Apply Preview Test Employee', ${DEPT_ID}, ${DESIG_ID}, '2015-01-01', 'permanent', ${EMPLOYEE_ID}, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, employee_type, user_ref, created_by, updated_by)
    VALUES (${OUTSIDER_ID}, ${TENANT}, 'APPV-002', 'Apply Preview Outsider', ${DEPT_ID}, ${DESIG_ID}, '2015-01-01', 'permanent', ${OUTSIDER_ID}, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  // CL: calendar-counted in the platform default catalog (rules-engine.ts's
  // LEAVE_POLICIES) — a single weekday needs no seeded holiday data to be a
  // deterministic 1-day preview.
  await asTenant((tx) => tx`INSERT INTO leave.hrms_leave_types (id, tenant_id, code, name, created_by, updated_by) VALUES (${LEAVE_TYPE_ID}, ${TENANT}, 'CL', 'Casual Leave', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`
    INSERT INTO leave.hrms_leave_allocs (id, tenant_id, employee_id, leave_type_id, fy, total_days, balance_days, created_by, updated_by)
    VALUES (${ALLOC_ID}, ${TENANT}, ${EMPLOYEE_ID}, ${LEAVE_TYPE_ID}, '2026-27', 8, 8, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

const PREVIEW_BODY = {
  employeeId: EMPLOYEE_ID,
  leaveTypeId: LEAVE_TYPE_ID,
  allocId: ALLOC_ID,
  fromDate: "2026-10-05", // a Monday
  toDate: "2026-10-05",
  daysApplied: 1,
};

describe("POST /v1/hrms/leave-requests/preview", () => {
  it("returns the same computedDays a real submit would debit, with NO side effect (no leave_apps row, balance untouched)", async () => {
    const preview = await app.inject({
      method: "POST", url: "/v1/hrms/leave-requests/preview",
      headers: { authorization: `Bearer ${selfToken}` },
      payload: PREVIEW_BODY,
    });
    expect(preview.statusCode).toBe(200);
    const previewBody = JSON.parse(preview.body) as { computedDays: number; engineApplied: boolean };
    expect(previewBody.engineApplied).toBe(true);
    expect(previewBody.computedDays).toBe(1);

    const rowsAfterPreview = await asTenant((tx) => tx`SELECT * FROM leave.hrms_leave_apps WHERE tenant_id = ${TENANT}`);
    expect(rowsAfterPreview).toHaveLength(0);
    const allocAfterPreview = await asTenant((tx) => tx`SELECT balance_days FROM leave.hrms_leave_allocs WHERE id = ${ALLOC_ID}`);
    expect(allocAfterPreview[0]!.balance_days).toBe(8);

    // The real submit, using preview's own computedDays — proves they agree.
    const submit = await app.inject({
      method: "POST", url: "/v1/hrms/leave-requests",
      headers: { authorization: `Bearer ${selfToken}` },
      payload: { ...PREVIEW_BODY, daysApplied: previewBody.computedDays, reason: "Personal work" },
    });
    expect(submit.statusCode).toBe(202);
    await drainQueue();
    const rowsAfterSubmit = await asTenant((tx) => tx`SELECT days_applied FROM leave.hrms_leave_apps WHERE tenant_id = ${TENANT}`);
    expect(rowsAfterSubmit).toHaveLength(1);
    expect(rowsAfterSubmit[0]!.days_applied).toBe(previewBody.computedDays);
  });

  it("enforces the same IDOR guard as the real submit — an employee cannot preview leave for someone else's employee record", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/leave-requests/preview",
      headers: { authorization: `Bearer ${outsiderToken}` },
      payload: PREVIEW_BODY, // employeeId is EMPLOYEE_ID, not OUTSIDER_ID
    });
    expect(r.statusCode).toBe(403);
  });
});
