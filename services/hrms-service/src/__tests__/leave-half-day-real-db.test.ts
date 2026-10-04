/**
 * GAP-HR-LEAVE-APPLY-05 -- half-day CL / short leave, real DB, no mocks.
 *
 * Proves end to end (route -> queue -> consumer -> Postgres):
 *  - the per-tenant switch defaults OFF (a half-day is refused 422) and an HR
 *    admin can turn it on;
 *  - a half-day debits 0.5 into the NEW numeric columns while the integer
 *    columns keep their safe whole-day shadow (days_applied = CEIL,
 *    balance_days = FLOOR);
 *  - a cancel of the approved half-day credits 0.5 back (round trip);
 *  - weekend/holiday, non-CL and same-half-twice requests are rejected, while
 *    first_half + second_half on one date are both accepted;
 *  - the payroll LOP feed reports 0.5 (not a rounded whole day) for an unpaid
 *    half-day.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import type { RequestContext } from "@civitasone/types";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { registerLeaveConsumers } from "../modules/leave/consumer.js";
import * as leaveCommands from "../modules/leave/commands.js";
import { cancelLeave } from "../modules/leave/cancel-commands.js";

registerLeaveConsumers(queue);
async function drainQueue(): Promise<void> {
  await (queue as unknown as { drain: () => Promise<void> }).drain();
}

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "facade00-a905-4000-8000-000000000a95";
const SEED_ACTOR = "facade00-a905-4000-8000-0000000000ff";
const DEPT_ID = "facade00-a905-4000-8000-0000000000d1";
const DESIG_ID = "facade00-a905-4000-8000-0000000000d2";
const EMPLOYEE_ID = "facade00-a905-4000-8000-0000000000e1";
const HR_ID = "facade00-a905-4000-8000-0000000000e9";
const CL_TYPE = "facade00-a905-4000-8000-0000000000ca";
const EL_TYPE = "facade00-a905-4000-8000-0000000000cb";
const CL_ALLOC = "facade00-a905-4000-8000-0000000000a1";
const EL_ALLOC = "facade00-a905-4000-8000-0000000000a2";

const MONDAY = "2026-10-05";
const SUNDAY = "2026-10-04";

const tok = (roles: string[], sub: string) => signToken({ sub, tid: TENANT, roles, sid: "sess-half-day-test" }, SECRET);
const empToken = tok(["employee"], EMPLOYEE_ID);
const hrToken = tok(["hr_admin"], HR_ID);

let app: Awaited<ReturnType<typeof buildApp>>;
const asTenant = <T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> => withRawTenantGuc(sqlClient, TENANT, fn);

const ctxFor = (actorId: string): RequestContext => ({
  tenantId: TENANT, actorId, correlationId: randomUUID(), roles: ["hr_admin"],
} as unknown as RequestContext);

function apply(part: string, over: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST", url: "/v1/hrms/leave-requests",
    headers: { authorization: `Bearer ${empToken}` },
    payload: {
      employeeId: EMPLOYEE_ID, leaveTypeId: CL_TYPE, allocId: CL_ALLOC,
      fromDate: MONDAY, toDate: MONDAY, daysApplied: part === "full" ? 1 : 0.5, dayPart: part,
      reason: "Half day for a personal errand", ...over,
    },
  });
}

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM leave.hrms_leave_apps WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM leave.hrms_leave_allocs WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM leave.hrms_leave_types WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM leave.hrms_leave_tenant_config WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

beforeAll(async () => {
  await cleanup();
  await asTenant((tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT_ID}, ${TENANT}, 'HDAY', 'Half Day Dept', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by) VALUES (${DESIG_ID}, ${TENANT}, 'HDAY', 'Half Day Desig', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  for (const [id, no, name] of [[EMPLOYEE_ID, "HDAY-001", "Half Day Employee"], [HR_ID, "HDAY-009", "Half Day HR"]] as const) {
    await asTenant((tx) => tx`
      INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, employee_type, user_ref, created_by, updated_by)
      VALUES (${id}, ${TENANT}, ${no}, ${name}, ${DEPT_ID}, ${DESIG_ID}, '2015-01-01', 'permanent', ${id}, ${SEED_ACTOR}, ${SEED_ACTOR})`);
  }
  await asTenant((tx) => tx`INSERT INTO leave.hrms_leave_types (id, tenant_id, code, name, created_by, updated_by) VALUES (${CL_TYPE}, ${TENANT}, 'CL', 'Casual Leave', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`INSERT INTO leave.hrms_leave_types (id, tenant_id, code, name, created_by, updated_by) VALUES (${EL_TYPE}, ${TENANT}, 'EL', 'Earned Leave', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`
    INSERT INTO leave.hrms_leave_allocs (id, tenant_id, employee_id, leave_type_id, fy, total_days, balance_days, created_by, updated_by)
    VALUES (${CL_ALLOC}, ${TENANT}, ${EMPLOYEE_ID}, ${CL_TYPE}, '2026-27', 8, 8, ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`
    INSERT INTO leave.hrms_leave_allocs (id, tenant_id, employee_id, leave_type_id, fy, total_days, balance_days, created_by, updated_by)
    VALUES (${EL_ALLOC}, ${TENANT}, ${EMPLOYEE_ID}, ${EL_TYPE}, '2026-27', 30, 30, ${SEED_ACTOR}, ${SEED_ACTOR})`);
  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

async function allocRow() {
  const r = await asTenant((tx) => tx`SELECT balance_days, balance_days_exact FROM leave.hrms_leave_allocs WHERE id = ${CL_ALLOC}`);
  return r[0]!;
}

describe("half-day / short leave (GAP-HR-LEAVE-APPLY-05)", () => {
  it("defaults OFF: a half-day is refused with HALF_DAY_NOT_ENABLED and nothing is written", async () => {
    const cfg = await app.inject({ method: "GET", url: "/v1/hrms/leave-config", headers: { authorization: `Bearer ${empToken}` } });
    expect(cfg.json()).toEqual({ halfDayEnabled: false, shortLeaveEnabled: false });
    const r = await apply("first_half");
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("HALF_DAY_NOT_ENABLED");
    expect(await asTenant((tx) => tx`SELECT 1 FROM leave.hrms_leave_apps WHERE tenant_id = ${TENANT}`)).toHaveLength(0);
  });

  it("only an HR admin can change the switch (employee 403), and the change is audited by the consumer", async () => {
    const denied = await app.inject({
      method: "PUT", url: "/v1/hrms/leave-config", headers: { authorization: `Bearer ${empToken}` },
      payload: { halfDayEnabled: true, shortLeaveEnabled: false },
    });
    expect(denied.statusCode).toBe(403);
    const ok = await app.inject({
      method: "PUT", url: "/v1/hrms/leave-config", headers: { authorization: `Bearer ${hrToken}` },
      payload: { halfDayEnabled: true, shortLeaveEnabled: false },
    });
    expect(ok.statusCode).toBe(202);
    await drainQueue();
    const cfg = await app.inject({ method: "GET", url: "/v1/hrms/leave-config", headers: { authorization: `Bearer ${empToken}` } });
    expect(cfg.json()).toEqual({ halfDayEnabled: true, shortLeaveEnabled: false });
  });

  it("short leave stays refused while only half-day is enabled", async () => {
    const r = await apply("short_leave");
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("HALF_DAY_NOT_ENABLED");
  });

  it("rejects non-CL, weekend and malformed half-days", async () => {
    const el = await apply("first_half", { leaveTypeId: EL_TYPE, allocId: EL_ALLOC });
    expect(el.statusCode).toBe(422);
    expect(el.json().code).toBe("HALF_DAY_NOT_ALLOWED");
    const sunday = await apply("first_half", { fromDate: SUNDAY, toDate: SUNDAY });
    expect(sunday.statusCode).toBe(422);
    expect(sunday.json().code).toBe("LEAVE_RULE_VIOLATION");
    const range = await apply("first_half", { toDate: "2026-10-06" });
    expect(range.statusCode).toBe(400);
    const wrongUnits = await apply("first_half", { daysApplied: 1 });
    expect(wrongUnits.statusCode).toBe(400);
    const fractionalFull = await apply("full", { daysApplied: 0.5 });
    expect(fractionalFull.statusCode).toBe(400);
  });

  it("first half debits 0.5 into the new numeric columns; integer columns keep a safe shadow; cancel credits it back", async () => {
    const r = await apply("first_half");
    expect(r.statusCode).toBe(202);
    await drainQueue();
    const rows = await asTenant((tx) => tx`SELECT id, days_applied, days_applied_exact, day_part, status FROM leave.hrms_leave_apps WHERE tenant_id = ${TENANT}`);
    expect(rows).toHaveLength(1);
    const app1 = rows[0]!;
    expect(app1.day_part).toBe("first_half");
    expect(Number(app1.days_applied_exact)).toBe(0.5);
    expect(app1.days_applied).toBe(1); // CEIL shadow for legacy whole-day readers

    await leaveCommands.approveLeave(ctxFor(HR_ID), app1.id as string);
    await drainQueue();
    const afterApprove = await allocRow();
    expect(Number(afterApprove.balance_days_exact)).toBe(7.5);
    expect(afterApprove.balance_days).toBe(7); // FLOOR shadow

    // the approved-event payload carries the exact figure payroll needs
    const ev = await asTenant((tx) => tx`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT} AND topic = 'hrms.leave.approved' ORDER BY created_at DESC LIMIT 1`);
    const payload = (typeof ev[0]!.payload === "string" ? JSON.parse(ev[0]!.payload as string) : ev[0]!.payload) as Record<string, unknown>;
    expect(payload.daysExact).toBe(0.5);
    expect(payload.dayPart).toBe("first_half");

    // the same half twice is an overlap; the OPPOSITE half of the same date is allowed
    const dup = await apply("first_half");
    expect(dup.statusCode).toBe(422);
    expect(dup.json().code).toBe("LEAVE_OVERLAP");
    const other = await apply("second_half");
    expect(other.statusCode).toBe(202);
    await drainQueue();

    await cancelLeave(ctxFor(HR_ID), app1.id as string, "plans changed");
    await drainQueue();
    const afterCancel = await allocRow();
    expect(Number(afterCancel.balance_days_exact)).toBe(8);
    expect(afterCancel.balance_days).toBe(8);
  });

  it("payroll LOP feed carries 0.5 (not a rounded whole day) for an unpaid approved half-day", async () => {
    const pending = await asTenant((tx) => tx`SELECT id FROM leave.hrms_leave_apps WHERE tenant_id = ${TENANT} AND day_part = 'second_half' AND status = 'pending'`);
    await leaveCommands.approveLeave(ctxFor(HR_ID), pending[0]!.id as string);
    await drainQueue();
    const feed = await app.inject({
      method: "GET", url: "/v1/hrms/internal/payroll-input?month=2026-10",
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(feed.statusCode).toBe(200);
    // CL's lop_fraction_bps column default is 10000 (fully unpaid) in this seed.
    expect(feed.json().lopDays[EMPLOYEE_ID]).toBe(0.5);
  });

  it("payroll feed carries each employee's HRMS gender and state of employment (null when unset) for per-state, gender-specific PT slabs", async () => {
    await asTenant((tx) => tx`UPDATE employee.hrms_employees SET gender = 'female', work_state_code = 'MH' WHERE id = ${EMPLOYEE_ID}`);
    const feed = await app.inject({
      method: "GET", url: "/v1/hrms/internal/payroll-input?month=2026-10",
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(feed.statusCode).toBe(200);
    const byId = new Map((feed.json().employees as Array<{ id: string; gender: string | null; stateCode: string | null }>).map((e) => [e.id, e]));
    expect(byId.get(EMPLOYEE_ID)).toMatchObject({ gender: "female", stateCode: "MH" });
    expect(byId.get(HR_ID)).toMatchObject({ gender: null, stateCode: null });
  });

  it("a whole-day approve + cancel on an integer-only balance never writes balance_days_exact", async () => {
    // EL is not allowed during probation; confirm the seeded employee first.
    await asTenant((tx) => tx`UPDATE employee.hrms_employees SET status = 'confirmed' WHERE id = ${EMPLOYEE_ID}`);
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/leave-requests", headers: { authorization: `Bearer ${empToken}` },
      payload: { employeeId: EMPLOYEE_ID, leaveTypeId: EL_TYPE, allocId: EL_ALLOC, fromDate: "2026-11-02", toDate: "2026-11-03", daysApplied: 2, reason: "Two whole days of earned leave" },
    });
    expect(r.statusCode).toBe(202);
    await drainQueue();
    const appRow = (await asTenant((tx) => tx`SELECT id, days_applied, days_applied_exact FROM leave.hrms_leave_apps WHERE tenant_id = ${TENANT} AND leave_type_id = ${EL_TYPE}`))[0]!;
    expect(appRow.days_applied_exact).toBeNull();
    await leaveCommands.approveLeave(ctxFor(HR_ID), appRow.id as string);
    await drainQueue();
    const afterApprove = (await asTenant((tx) => tx`SELECT balance_days, balance_days_exact FROM leave.hrms_leave_allocs WHERE id = ${EL_ALLOC}`))[0]!;
    expect(afterApprove.balance_days).toBe(28);
    expect(afterApprove.balance_days_exact).toBeNull();
    await cancelLeave(ctxFor(HR_ID), appRow.id as string, "plans changed");
    await drainQueue();
    const afterCancel = (await asTenant((tx) => tx`SELECT balance_days, balance_days_exact FROM leave.hrms_leave_allocs WHERE id = ${EL_ALLOC}`))[0]!;
    expect(afterCancel.balance_days).toBe(30);
    expect(afterCancel.balance_days_exact).toBeNull();
  });

  it("concurrent double-submit: full day vs first half on the same date -> exactly one live application", async () => {
    const day = "2026-11-09"; // Monday
    const [a, b] = await Promise.all([apply("full", { fromDate: day, toDate: day }), apply("first_half", { fromDate: day, toDate: day })]);
    expect([a.statusCode, b.statusCode].every((s) => s === 202 || s === 422)).toBe(true);
    await drainQueue();
    const live = await asTenant((tx) => tx`SELECT day_part FROM leave.hrms_leave_apps WHERE tenant_id = ${TENANT} AND leave_type_id = ${CL_TYPE} AND from_date = ${day} AND status IN ('pending','approved')`);
    expect(live).toHaveLength(1);
  });

  it("concurrent double-submit: first half vs short leave on the same date -> exactly one live application", async () => {
    await app.inject({ method: "PUT", url: "/v1/hrms/leave-config", headers: { authorization: `Bearer ${hrToken}` }, payload: { halfDayEnabled: true, shortLeaveEnabled: true } });
    await drainQueue();
    const day = "2026-11-10"; // Tuesday
    const [a, b] = await Promise.all([apply("first_half", { fromDate: day, toDate: day }), apply("short_leave", { fromDate: day, toDate: day })]);
    expect([a.statusCode, b.statusCode].every((s) => s === 202 || s === 422)).toBe(true);
    await drainQueue();
    const live = await asTenant((tx) => tx`SELECT day_part FROM leave.hrms_leave_apps WHERE tenant_id = ${TENANT} AND leave_type_id = ${CL_TYPE} AND from_date = ${day} AND status IN ('pending','approved')`);
    expect(live).toHaveLength(1);
  });

  it("an integer-only balance is untouched by whole-day operations (legacy path)", async () => {
    const before = await asTenant((tx) => tx`SELECT balance_days, balance_days_exact FROM leave.hrms_leave_allocs WHERE id = ${EL_ALLOC}`);
    expect(before[0]!.balance_days_exact).toBeNull();
    expect(before[0]!.balance_days).toBe(30);
  });
});
