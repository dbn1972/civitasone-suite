/**
 * GAP-HR-LEAVE-APPLY-01 / -04 — real-DB round-trip regression test.
 *
 * POST /v1/hrms/leave-requests/preview runs evaluateLeaveRules, the same
 * function the real POST /v1/hrms/leave-requests runs before publishing — this
 * proves preview and submit can never diverge (including over a Fri-Mon range
 * spanning a tenant holiday, where the engine's day count differs from the
 * naive calendar count), that preview has no side effect (no leave_apps row,
 * no balance debit), that rule outcomes come back as data the form can show
 * (warnings, violations, balance, balance-after), and that an over-balance
 * request is refused synchronously for leave codes OUTSIDE the CCS engine too
 * (it used to 202 and then fail silently in the consumer).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { registerLeaveConsumers } from "../modules/leave/consumer.js";
import * as leaveCommands from "../modules/leave/commands.js";

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
// EL counts WORKING days (the CCS engine), so a Fri-Mon range over a Monday
// holiday is 1 debited day against a naive calendar count of 4.
const EL_TYPE_ID = "facade00-a901-4000-8000-0000000000cb";
const EL_ALLOC_ID = "facade00-a901-4000-8000-0000000000a2";
// EOL is outside the CCS engine's catalogue: the client day count stands and
// only the balance is checked.
const EOL_TYPE_ID = "facade00-a901-4000-8000-0000000000cc";
const EOL_ALLOC_ID = "facade00-a901-4000-8000-0000000000a3";
const OUTSIDER_ALLOC_ID = "facade00-a901-4000-8000-0000000000a4";

function tok(roles: string[], sub: string) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-apply-preview-test" }, SECRET);
}
const selfToken = tok(["employee"], EMPLOYEE_ID); // sub === the employee's own id resolves via actor-link's userRef fallback path in some setups; see resolveEmployeeForActor
const outsiderToken = tok(["employee"], OUTSIDER_ID);
const hrToken = tok(["hr_admin"], SEED_ACTOR);

let app: Awaited<ReturnType<typeof buildApp>>;

function asTenant<T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, TENANT, fn);
}

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
  await asTenant((tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT_ID}, ${TENANT}, 'APPV', 'Apply Preview Test Dept', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by) VALUES (${DESIG_ID}, ${TENANT}, 'APPV', 'Apply Preview Test Designation', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, employee_type, status, user_ref, created_by, updated_by)
    VALUES (${EMPLOYEE_ID}, ${TENANT}, 'APPV-001', 'Apply Preview Test Employee', ${DEPT_ID}, ${DESIG_ID}, '2015-01-01', 'permanent', 'confirmed', ${EMPLOYEE_ID}, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, employee_type, user_ref, created_by, updated_by)
    VALUES (${OUTSIDER_ID}, ${TENANT}, 'APPV-002', 'Apply Preview Outsider', ${DEPT_ID}, ${DESIG_ID}, '2015-01-01', 'permanent', ${OUTSIDER_ID}, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  // CL: calendar-counted in the platform default catalog (rules-engine.ts's
  // LEAVE_POLICIES) — a single weekday needs no seeded holiday data to be a
  // deterministic 1-day preview.
  await asTenant((tx) => tx`INSERT INTO leave.hrms_leave_types (id, tenant_id, code, name, created_by, updated_by) VALUES (${LEAVE_TYPE_ID}, ${TENANT}, 'CL', 'Casual Leave', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`INSERT INTO leave.hrms_leave_types (id, tenant_id, code, name, created_by, updated_by) VALUES (${EL_TYPE_ID}, ${TENANT}, 'EL', 'Earned Leave', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`INSERT INTO leave.hrms_leave_types (id, tenant_id, code, name, created_by, updated_by) VALUES (${EOL_TYPE_ID}, ${TENANT}, 'EOL', 'Extraordinary Leave', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant((tx) => tx`
    INSERT INTO leave.hrms_leave_allocs (id, tenant_id, employee_id, leave_type_id, fy, total_days, balance_days, created_by, updated_by)
    VALUES (${ALLOC_ID}, ${TENANT}, ${EMPLOYEE_ID}, ${LEAVE_TYPE_ID}, '2026-27', 8, 8, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO leave.hrms_leave_allocs (id, tenant_id, employee_id, leave_type_id, fy, total_days, balance_days, created_by, updated_by)
    VALUES (${EL_ALLOC_ID}, ${TENANT}, ${EMPLOYEE_ID}, ${EL_TYPE_ID}, '2026-27', 30, 30, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO leave.hrms_leave_allocs (id, tenant_id, employee_id, leave_type_id, fy, total_days, balance_days, created_by, updated_by)
    VALUES (${EOL_ALLOC_ID}, ${TENANT}, ${EMPLOYEE_ID}, ${EOL_TYPE_ID}, '2026-27', 2, 2, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO leave.hrms_leave_allocs (id, tenant_id, employee_id, leave_type_id, fy, total_days, balance_days, created_by, updated_by)
    VALUES (${OUTSIDER_ALLOC_ID}, ${TENANT}, ${OUTSIDER_ID}, ${LEAVE_TYPE_ID}, '2026-27', 8, 8, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  // Monday 12 Oct 2026 is a tenant holiday: a Fri-Mon request spans it.
  await asTenant((tx) => tx`INSERT INTO leave.hrms_holidays (tenant_id, name, date, created_by) VALUES (${TENANT}, 'Apply Preview Test Holiday', '2026-10-12', ${SEED_ACTOR})`);
  app = await buildApp();
});

afterEach(async () => {
  // Each test starts from "no applications" so date ranges can be reused, and
  // from the seeded balances (the consumer test lowers one on purpose).
  await asTenant((tx) => tx`DELETE FROM leave.hrms_leave_apps WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`UPDATE leave.hrms_leave_allocs SET balance_days = total_days WHERE tenant_id = ${TENANT}`);
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

type Preview = {
  valid: boolean;
  computedDays: number;
  engineApplied: boolean;
  warnings: string[];
  violations: Array<{ code: string; message: string }>;
  holidaysInRange: string[];
  balance: number;
  balanceAfter: number;
};

function post(url: string, token: string, payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url, headers: { authorization: `Bearer ${token}` }, payload });
}

describe("POST /v1/hrms/leave-requests/preview", () => {
  it("returns the same computedDays a real submit would debit, with NO side effect (no leave_apps row, balance untouched)", async () => {
    const preview = await post("/v1/hrms/leave-requests/preview", selfToken, PREVIEW_BODY);
    expect(preview.statusCode).toBe(200);
    const previewBody = JSON.parse(preview.body) as Preview;
    expect(previewBody.valid).toBe(true);
    expect(previewBody.engineApplied).toBe(true);
    expect(previewBody.computedDays).toBe(1);

    const rowsAfterPreview = await asTenant((tx) => tx`SELECT * FROM leave.hrms_leave_apps WHERE tenant_id = ${TENANT}`);
    expect(rowsAfterPreview).toHaveLength(0);
    const allocAfterPreview = await asTenant((tx) => tx`SELECT balance_days FROM leave.hrms_leave_allocs WHERE id = ${ALLOC_ID}`);
    expect(allocAfterPreview[0]!.balance_days).toBe(8);

    // The real submit, using preview's own computedDays — proves they agree.
    const submit = await post("/v1/hrms/leave-requests", selfToken, { ...PREVIEW_BODY, daysApplied: previewBody.computedDays, reason: "Personal work" });
    expect(submit.statusCode).toBe(202);
    await drainQueue();
    const rowsAfterSubmit = await asTenant((tx) => tx`SELECT days_applied FROM leave.hrms_leave_apps WHERE tenant_id = ${TENANT}`);
    expect(rowsAfterSubmit).toHaveLength(1);
    expect(rowsAfterSubmit[0]!.days_applied).toBe(previewBody.computedDays);
  });

  it("CL Fri-Mon spanning a holiday: previews the sandwich-rule day count + warning + holiday + balance-after, and submit persists exactly that count", async () => {
    const range = { ...PREVIEW_BODY, fromDate: "2026-10-09", toDate: "2026-10-12", daysApplied: 4 }; // Fri .. Mon (holiday)
    const preview = await post("/v1/hrms/leave-requests/preview", selfToken, range);
    expect(preview.statusCode).toBe(200);
    const p = JSON.parse(preview.body) as Preview;
    expect(p.valid).toBe(true);
    expect(p.engineApplied).toBe(true);
    // Sat + Sun + the Monday holiday are sandwiched inside the range, so all 4 calendar days count.
    expect(p.computedDays).toBe(4);
    expect(p.warnings.some((w) => /sandwich/i.test(w))).toBe(true);
    expect(p.holidaysInRange).toEqual(["2026-10-12"]);
    expect(p.balance).toBe(8);
    expect(p.balanceAfter).toBe(4);

    // Submit with a WRONG client count: the server's engine count is what is persisted.
    const submit = await post("/v1/hrms/leave-requests", selfToken, { ...range, daysApplied: 1, reason: "Long weekend with the family" });
    expect(submit.statusCode).toBe(202);
    await drainQueue();
    const rows = await asTenant((tx) => tx`SELECT days_applied FROM leave.hrms_leave_apps WHERE tenant_id = ${TENANT}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.days_applied).toBe(p.computedDays);
  });

  it("EL Fri-Mon over a Monday holiday: preview shows 1 working day (not the naive 4) and submit persists 1", async () => {
    const range = { employeeId: EMPLOYEE_ID, leaveTypeId: EL_TYPE_ID, allocId: EL_ALLOC_ID, fromDate: "2026-10-09", toDate: "2026-10-12", daysApplied: 4 };
    const preview = await post("/v1/hrms/leave-requests/preview", selfToken, range);
    expect(preview.statusCode).toBe(200);
    const p = JSON.parse(preview.body) as Preview;
    expect(p.valid).toBe(true);
    expect(p.computedDays).toBe(1);
    expect(p.balance).toBe(30);
    expect(p.balanceAfter).toBe(29);

    const submit = await post("/v1/hrms/leave-requests", selfToken, { ...range, reason: "Attending a family wedding in the city" });
    expect(submit.statusCode).toBe(202);
    await drainQueue();
    const rows = await asTenant((tx) => tx`SELECT days_applied FROM leave.hrms_leave_apps WHERE tenant_id = ${TENANT}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.days_applied).toBe(1);
  });

  it("a request over the balance previews as valid:false with the engine's reasons and the shortfall, and submit answers 422 with the same reasons", async () => {
    // 19 Oct .. 27 Oct = 9 calendar days of CL (balance 8, max continuous 8).
    const range = { ...PREVIEW_BODY, fromDate: "2026-10-19", toDate: "2026-10-27", daysApplied: 9 };
    const preview = await post("/v1/hrms/leave-requests/preview", selfToken, range);
    expect(preview.statusCode).toBe(200);
    const p = JSON.parse(preview.body) as Preview;
    expect(p.valid).toBe(false);
    expect(p.violations.length).toBeGreaterThan(0);
    expect(p.violations.every((v) => v.code === "LEAVE_RULE_VIOLATION")).toBe(true);
    expect(p.violations.some((v) => /insufficient balance/i.test(v.message))).toBe(true);
    expect(p.balanceAfter).toBeLessThan(0);

    const submit = await post("/v1/hrms/leave-requests", selfToken, { ...range, reason: "A long trip out of the country" });
    expect(submit.statusCode).toBe(422);
    expect(submit.json().code).toBe("LEAVE_RULE_VIOLATION");
    for (const v of p.violations) expect(submit.json().message).toContain(v.message);
    const rows = await asTenant((tx) => tx`SELECT id FROM leave.hrms_leave_apps WHERE tenant_id = ${TENANT}`);
    expect(rows).toHaveLength(0);
  });

  it("a leave code outside the CCS engine (EOL): preview reports engineApplied:false, and an over-balance request is refused synchronously (422), not accepted then dropped", async () => {
    const base = { employeeId: EMPLOYEE_ID, leaveTypeId: EOL_TYPE_ID, allocId: EOL_ALLOC_ID, fromDate: "2026-11-02", toDate: "2026-11-04" };

    const over = await post("/v1/hrms/leave-requests/preview", selfToken, { ...base, daysApplied: 3 });
    expect(over.statusCode).toBe(200);
    const o = JSON.parse(over.body) as Preview;
    expect(o.engineApplied).toBe(false);
    expect(o.valid).toBe(false);
    expect(o.violations[0]!.code).toBe("INSUFFICIENT_LEAVE_BALANCE");
    expect(o.balance).toBe(2);
    expect(o.balanceAfter).toBe(-1);

    const refused = await post("/v1/hrms/leave-requests", selfToken, { ...base, daysApplied: 3, reason: "Extended personal matter abroad" });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().code).toBe("INSUFFICIENT_LEAVE_BALANCE");

    const within = await post("/v1/hrms/leave-requests/preview", selfToken, { ...base, toDate: "2026-11-03", daysApplied: 2 });
    const w = JSON.parse(within.body) as Preview;
    expect(w.engineApplied).toBe(false);
    expect(w.valid).toBe(true);
    expect(w.computedDays).toBe(2);
    expect(w.balanceAfter).toBe(0);
    const ok = await post("/v1/hrms/leave-requests", selfToken, { ...base, toDate: "2026-11-03", daysApplied: 2, reason: "Extended personal matter abroad" });
    expect(ok.statusCode).toBe(202);
  });

  it("enforces the same IDOR guard as the real submit — an employee cannot preview leave for someone else's employee record", async () => {
    const r = await post("/v1/hrms/leave-requests/preview", outsiderToken, PREVIEW_BODY); // employeeId is EMPLOYEE_ID, not OUTSIDER_ID
    expect(r.statusCode).toBe(403);
  });

  it("refuses an allocation that is not this employee's pool for this leave type (preview and submit), so a balance cannot be borrowed by passing its id", async () => {
    // HR may act for anyone, so this isolates the allocation check from the IDOR guard above.
    const otherEmployeesAlloc = { ...PREVIEW_BODY, allocId: OUTSIDER_ALLOC_ID };
    for (const url of ["/v1/hrms/leave-requests/preview", "/v1/hrms/leave-requests"]) {
      const r = await post(url, hrToken, { ...otherEmployeesAlloc, reason: "On behalf of the employee" });
      expect(r.statusCode).toBe(404);
      expect(r.json().code).toBe("ALLOC_NOT_FOUND");
    }
    const wrongType = { ...PREVIEW_BODY, leaveTypeId: EL_TYPE_ID }; // CL pool presented as Earned Leave
    const r2 = await post("/v1/hrms/leave-requests/preview", hrToken, wrongType);
    expect(r2.statusCode).toBe(404);
  });
});

describe("leaveApply consumer — insufficient balance is observable (GAP-HR-LEAVE-APPLY-04)", () => {
  it("when the balance drops between the route's check and the consumer, records a FAILED audit event and notifies the applicant instead of throwing silently", async () => {
    const body = { employeeId: EMPLOYEE_ID, leaveTypeId: EOL_TYPE_ID, allocId: EOL_ALLOC_ID, fromDate: "2026-11-09", toDate: "2026-11-10", daysApplied: 2, dayPart: "full" as const, reason: "Family emergency requiring travel" };

    // A concurrent approval / HR adjustment spends the balance after the route
    // accepted the request (it checked 2 <= 2) but before the consumer runs.
    // Publishing the command directly stands in for that already-accepted
    // message deterministically (the in-memory queue delivers on a timer, so
    // racing an UPDATE against a route call would be flaky).
    await asTenant((tx) => tx`UPDATE leave.hrms_leave_allocs SET balance_days = 0 WHERE id = ${EOL_ALLOC_ID}`);
    const ctx = { tenantId: TENANT, actorId: EMPLOYEE_ID, correlationId: randomUUID(), roles: ["employee"] } as unknown as RequestContext;
    const accepted = await leaveCommands.applyLeave(ctx, body);
    const appId = accepted.id;
    await drainQueue();

    const rows = await asTenant((tx) => tx`SELECT id FROM leave.hrms_leave_apps WHERE tenant_id = ${TENANT}`);
    expect(rows).toHaveLength(0);

    const audits = await asTenant((tx) => tx`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT} AND topic = 'audit.event.record' AND payload->>'resourceId' = ${appId}`);
    expect(audits).toHaveLength(1);
    const audit = (typeof audits[0]!.payload === "string" ? JSON.parse(audits[0]!.payload as string) : audits[0]!.payload) as { outcome: string; metadata: { reason: string; requestedDays: number; balanceDays: number } };
    expect(audit.outcome).toBe("failure");
    expect(audit.metadata).toMatchObject({ reason: "INSUFFICIENT_LEAVE_BALANCE", requestedDays: 2, balanceDays: 0 });

    const notices = await asTenant((tx) => tx`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT} AND topic = 'notification.send' AND payload->>'eventType' = 'hrms.leave.apply_failed' AND payload->'variables'->>'leaveAppId' = ${appId}`);
    expect(notices).toHaveLength(1);
    const notice = (typeof notices[0]!.payload === "string" ? JSON.parse(notices[0]!.payload as string) : notices[0]!.payload) as { recipientId: string };
    expect(notice.recipientId).toBe(EMPLOYEE_ID);
  });
});
