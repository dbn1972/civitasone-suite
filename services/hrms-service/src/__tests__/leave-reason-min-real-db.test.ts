/**
 * GAP-HR-LEAVE-APPLY-04 (owner decision, 26 Nov 2026): the server enforces the 20-character leave reason that
 * the apply form always required client-side. Real DB, no mocks.
 *   - submit (POST /leave-requests and the legacy /leave-applications) with a short or missing reason => 400
 *     VALIDATION_FAILED with a field error on `reason`; nothing is queued;
 *   - the preview does NOT enforce it (it runs while the applicant is still typing);
 *   - a request queued OFFLINE before the cut-over is grandfathered via the x-queued-at header the web replay adds.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { registerLeaveConsumers } from "../modules/leave/consumer.js";

registerLeaveConsumers(queue);
const drainQueue = () => (queue as unknown as { drain: () => Promise<void> }).drain();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "facade00-a902-4000-8000-000000000c01";
const SEED_ACTOR = "facade00-a902-4000-8000-00000000c0ff";
const DEPT_ID = "facade00-a902-4000-8000-00000000c0d1";
const DESIG_ID = "facade00-a902-4000-8000-00000000c0d2";
const EMPLOYEE_ID = "facade00-a902-4000-8000-00000000c0e1";
const EL_TYPE_ID = "facade00-a902-4000-8000-00000000c0cb";
const EL_ALLOC_ID = "facade00-a902-4000-8000-00000000c0a2";

const selfToken = signToken({ sub: EMPLOYEE_ID, tid: TENANT, roles: ["employee"], sid: "sess-leave-reason" }, SECRET);
let app: Awaited<ReturnType<typeof buildApp>>;
const asTenant = <T>(fn: (tx: typeof sqlClient) => Promise<T>) => withRawTenantGuc(sqlClient, TENANT, fn);
const post = (url: string, payload: Record<string, unknown>, headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url, headers: { authorization: `Bearer ${selfToken}`, ...headers }, payload });

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
  await asTenant((tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT_ID}, ${TENANT}, 'LR', 'Revenue Department', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by) VALUES (${DESIG_ID}, ${TENANT}, 'LR', 'Section Officer', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, employee_type, status, user_ref, created_by, updated_by)
    VALUES (${EMPLOYEE_ID}, ${TENANT}, 'LR-001', 'Kavita Menon', ${DEPT_ID}, ${DESIG_ID}, '2015-01-01', 'permanent', 'confirmed', ${EMPLOYEE_ID}, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`INSERT INTO leave.hrms_leave_types (id, tenant_id, code, name, created_by, updated_by) VALUES (${EL_TYPE_ID}, ${TENANT}, 'EL', 'Earned Leave', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`
    INSERT INTO leave.hrms_leave_allocs (id, tenant_id, employee_id, leave_type_id, fy, total_days, balance_days, created_by, updated_by)
    VALUES (${EL_ALLOC_ID}, ${TENANT}, ${EMPLOYEE_ID}, ${EL_TYPE_ID}, '2026-27', 30, 30, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  app = await buildApp();
});

afterEach(async () => {
  await drainQueue();
  await asTenant((tx) => tx`DELETE FROM leave.hrms_leave_apps WHERE tenant_id = ${TENANT}`);
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

// Mon 8 - Tue 9 Feb 2027: two working days inside the 2026-27 allocation.
const body = (reason?: string) => ({
  employeeId: EMPLOYEE_ID, leaveTypeId: EL_TYPE_ID, allocId: EL_ALLOC_ID, fromDate: "2027-02-08", toDate: "2027-02-09", daysApplied: 2,
  ...(reason === undefined ? {} : { reason }),
});
const count = async () => (await asTenant((tx) => tx`SELECT 1 FROM leave.hrms_leave_apps WHERE tenant_id = ${TENANT}`)).length;

describe("POST /v1/hrms/leave-requests -- 20-character reason (GAP-HR-LEAVE-APPLY-04)", () => {
  it("a 5-character reason is refused with a field error on `reason`; nothing is queued", async () => {
    const res = await post("/v1/hrms/leave-requests", body("fever"));
    expect(res.statusCode).toBe(400);
    const e = res.json() as { code: string; fieldErrors?: Record<string, unknown> | Array<{ path?: string }> };
    expect(e.code).toBe("VALIDATION_FAILED");
    expect(JSON.stringify(e.fieldErrors)).toContain("reason");
    await drainQueue();
    expect(await count()).toBe(0);
  });

  it("a missing reason is refused the same way, on the legacy /leave-applications route too", async () => {
    expect((await post("/v1/hrms/leave-requests", body())).statusCode).toBe(400);
    expect((await post("/v1/hrms/leave-applications", body("too short"))).statusCode).toBe(400);
  });

  it("a reason of 20+ characters is accepted (202) and the application is created", async () => {
    const res = await post("/v1/hrms/leave-requests", body("Attending my sister's wedding in Mysuru"));
    expect(res.statusCode).toBe(202);
    await drainQueue();
    expect(await count()).toBe(1);
  });

  it("the PREVIEW does not enforce it -- the applicant is still typing", async () => {
    const res = await post("/v1/hrms/leave-requests/preview", body("fev"));
    expect(res.statusCode).toBe(200);
    expect((res.json() as { valid: boolean }).valid).toBe(true);
  });

  it("a stamp after the cut-over, or in the future, is never honoured (the grandfather rule itself is unit-tested with an injected clock)", async () => {
    const fresh = await post("/v1/hrms/leave-requests", body("fever"), { "x-queued-at": "2026-12-05T10:15:00.000Z" });
    expect(fresh.statusCode).toBe(400);
    const future = await post("/v1/hrms/leave-requests", body("fever"), { "x-queued-at": "2026-11-20T10:15:00.000Z".replace("2026", "2099") });
    expect(future.statusCode).toBe(400);
  });
});
