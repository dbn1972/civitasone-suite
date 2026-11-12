/**
 * A leave request whose every date is a public holiday or a weekend debits 0 days. The preview used to
 * say "0 days" and stay valid; the submit then answered a bare 400 VALIDATION_FAILED. Real-DB test:
 * preview => valid:false + LEAVE_NO_WORKING_DAYS; submit => 422 with the same specific code/message,
 * nothing queued; a working day, and a range that merely contains a holiday, are still accepted.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { registerLeaveConsumers } from "../modules/leave/consumer.js";
import { LEAVE_NO_WORKING_DAYS, LEAVE_NO_WORKING_DAYS_MESSAGE } from "../modules/leave/routes.js";

registerLeaveConsumers(queue);
const drainQueue = () => (queue as unknown as { drain: () => Promise<void> }).drain();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "facade00-a901-4000-8000-000000000b01";
const SEED_ACTOR = "facade00-a901-4000-8000-00000000b0ff";
const DEPT_ID = "facade00-a901-4000-8000-00000000b0d1";
const DESIG_ID = "facade00-a901-4000-8000-00000000b0d2";
const EMPLOYEE_ID = "facade00-a901-4000-8000-00000000b0e1";
const EL_TYPE_ID = "facade00-a901-4000-8000-00000000b0cb";
const EL_ALLOC_ID = "facade00-a901-4000-8000-00000000b0a2";

const selfToken = signToken({ sub: EMPLOYEE_ID, tid: TENANT, roles: ["employee"], sid: "sess-zero-day" }, SECRET);
let app: Awaited<ReturnType<typeof buildApp>>;
const asTenant = <T>(fn: (tx: typeof sqlClient) => Promise<T>) => withRawTenantGuc(sqlClient, TENANT, fn);
const post = (url: string, payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url, headers: { authorization: `Bearer ${selfToken}` }, payload });

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM leave.hrms_holidays WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM leave.hrms_leave_apps WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM leave.hrms_leave_allocs WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM leave.hrms_leave_types WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

beforeAll(async () => {
  await cleanup();
  await asTenant((tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT_ID}, ${TENANT}, 'ZD', 'Zero Day Dept', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by) VALUES (${DESIG_ID}, ${TENANT}, 'ZD', 'Zero Day Designation', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, employee_type, status, user_ref, created_by, updated_by)
    VALUES (${EMPLOYEE_ID}, ${TENANT}, 'ZD-001', 'Zero Day Employee', ${DEPT_ID}, ${DESIG_ID}, '2015-01-01', 'permanent', 'confirmed', ${EMPLOYEE_ID}, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`INSERT INTO leave.hrms_leave_types (id, tenant_id, code, name, created_by, updated_by) VALUES (${EL_TYPE_ID}, ${TENANT}, 'EL', 'Earned Leave', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`
    INSERT INTO leave.hrms_leave_allocs (id, tenant_id, employee_id, leave_type_id, fy, total_days, balance_days, created_by, updated_by)
    VALUES (${EL_ALLOC_ID}, ${TENANT}, ${EMPLOYEE_ID}, ${EL_TYPE_ID}, '2026-27', 30, 30, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  // 26 Jan 2027 (Tuesday, Republic Day).
  await asTenant((tx) => tx`INSERT INTO leave.hrms_holidays (tenant_id, name, date, created_by) VALUES (${TENANT}, 'Republic Day', '2027-01-26', ${SEED_ACTOR})`);
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

const body = (fromDate: string, toDate: string, daysApplied: number) => ({
  employeeId: EMPLOYEE_ID, leaveTypeId: EL_TYPE_ID, allocId: EL_ALLOC_ID, fromDate, toDate, daysApplied, reason: "Personal work that needs a day off",
});
const count = async () => (await asTenant((tx) => tx`SELECT 1 FROM leave.hrms_leave_apps WHERE tenant_id = ${TENANT}`)).length;

describe("zero-day leave (holiday / weekend only)", () => {
  it("exports the code and the exact user-facing message", () => {
    expect(LEAVE_NO_WORKING_DAYS).toBe("LEAVE_NO_WORKING_DAYS");
    expect(LEAVE_NO_WORKING_DAYS_MESSAGE).toBe("The selected dates are holidays or weekends; no leave days to apply");
  });

  it("holiday only: preview is valid:false with the specific violation", async () => {
    const res = await post("/v1/hrms/leave-requests/preview", body("2027-01-26", "2027-01-26", 1));
    expect(res.statusCode).toBe(200);
    const p = res.json() as { valid: boolean; computedDays: number; violations: Array<{ code: string; message: string }> };
    expect(p.valid).toBe(false);
    expect(p.computedDays).toBe(0);
    expect(p.violations).toEqual([{ code: LEAVE_NO_WORKING_DAYS, message: LEAVE_NO_WORKING_DAYS_MESSAGE }]);
  });

  it("holiday only: submit answers 422 with the specific code and message (not a bare 400 VALIDATION_FAILED); nothing is queued", async () => {
    const res = await post("/v1/hrms/leave-requests", body("2027-01-26", "2027-01-26", 1));
    expect(res.statusCode).toBe(422);
    const e = res.json() as { code: string; message: string };
    expect(e.code).toBe(LEAVE_NO_WORKING_DAYS);
    expect(e.message).toBe(LEAVE_NO_WORKING_DAYS_MESSAGE);
    await drainQueue();
    expect(await count()).toBe(0);
  });

  it("the legacy /leave-applications route refuses it the same way", async () => {
    const res = await post("/v1/hrms/leave-applications", body("2027-01-26", "2027-01-26", 1));
    expect(res.statusCode).toBe(422);
    expect((res.json() as { code: string }).code).toBe(LEAVE_NO_WORKING_DAYS);
  });

  it("a Saturday-Sunday range (EL counts working days) is refused too", async () => {
    const res = await post("/v1/hrms/leave-requests", body("2026-10-10", "2026-10-11", 2));
    expect(res.statusCode).toBe(422);
    expect((res.json() as { code: string }).code).toBe(LEAVE_NO_WORKING_DAYS);
  });

  it("control: a normal working day is still accepted (202) and persisted", async () => {
    const pre = await post("/v1/hrms/leave-requests/preview", body("2026-10-05", "2026-10-05", 1));
    expect((pre.json() as { valid: boolean; computedDays: number }).valid).toBe(true);
    const res = await post("/v1/hrms/leave-requests", body("2026-10-05", "2026-10-05", 1));
    expect(res.statusCode).toBe(202);
    await drainQueue();
    expect(await count()).toBe(1);
  });

  it("control: a range that merely CONTAINS the holiday still has working days and is accepted", async () => {
    const res = await post("/v1/hrms/leave-requests", body("2027-01-25", "2027-01-27", 3));
    expect(res.statusCode).toBe(202);
  });
});
