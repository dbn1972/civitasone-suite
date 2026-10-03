/**
 * GAP-HR-LEAVE-ALLOCATE-01 (optional reason, recorded in the audit) and
 * GAP-HR-LEAVE-ALLOCATE-03 (server-side policy cap: above the leave type's
 * maxDays is refused unless overridden with a reason) -- real DB round trip.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { registerLeaveConsumers } from "../modules/leave/consumer.js";

registerLeaveConsumers(queue);
const drain = () => (queue as unknown as { drain: () => Promise<void> }).drain();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "facade00-a110-4000-8000-000000000b22";
const ACTOR = "facade00-a110-4000-8000-0000000000fb";
const DEPT_ID = "facade00-a110-4000-8000-0000000000b1";
const DESIG_ID = "facade00-a110-4000-8000-0000000000b2";
const EMP = "facade00-a110-4000-8000-0000000000b3";
const CAPPED = "facade00-a110-4000-8000-0000000000b4"; // maxDays 12
const UNCAPPED = "facade00-a110-4000-8000-0000000000b5"; // maxDays 0 == no cap

const authAs = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s-alloc-cap" }, SECRET)}` });
const auth = () => authAs(["hr_admin"]);
let app: Awaited<ReturnType<typeof buildApp>>;
const asTenant = <T>(fn: (tx: typeof sqlClient) => Promise<T>) => withRawTenantGuc(sqlClient, TENANT, fn);

async function cleanup() {
  await asTenant((tx) => tx`DELETE FROM leave.hrms_leave_allocs WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM leave.hrms_leave_types WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

beforeAll(async () => {
  await cleanup();
  await asTenant((tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT_ID}, ${TENANT}, 'ALCAP', 'Cap Dept', ${ACTOR}, ${ACTOR})`);
  await asTenant((tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by) VALUES (${DESIG_ID}, ${TENANT}, 'ALCAP', 'Cap Desig', ${ACTOR}, ${ACTOR})`);
  await asTenant((tx) => tx`INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by) VALUES (${EMP}, ${TENANT}, 'ALCAP-1', 'Cap Employee', ${DEPT_ID}, ${DESIG_ID}, '2020-01-01', ${ACTOR}, ${ACTOR})`);
  await asTenant((tx) => tx`INSERT INTO leave.hrms_leave_types (id, tenant_id, code, name, max_days, created_by, updated_by) VALUES (${CAPPED}, ${TENANT}, 'CAPC', 'Capped Leave', 12, ${ACTOR}, ${ACTOR})`);
  await asTenant((tx) => tx`INSERT INTO leave.hrms_leave_types (id, tenant_id, code, name, max_days, created_by, updated_by) VALUES (${UNCAPPED}, ${TENANT}, 'UNCP', 'Uncapped Leave', 0, ${ACTOR}, ${ACTOR})`);
  app = await buildApp();
});
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

const post = (payload: Record<string, unknown>, roles: string[] = ["hr_admin"]) =>
  app.inject({ method: "POST", url: "/v1/hrms/leave-allocations", headers: authAs(roles), payload: { employeeId: EMP, leaveTypeId: CAPPED, fy: "2026-27", ...payload } });
const rows = (fy: string, lt = CAPPED) => asTenant((tx) => tx`SELECT total_days, balance_days FROM leave.hrms_leave_allocs WHERE tenant_id = ${TENANT} AND employee_id = ${EMP} AND leave_type_id = ${lt} AND fy = ${fy}`);
async function audits(allocId: string) {
  const r = await asTenant((tx) => tx`SELECT payload FROM _outbox.messages WHERE topic = 'audit.event.record' AND payload->>'resourceType' = 'leave_alloc' AND payload->>'resourceId' = ${allocId} ORDER BY created_at`);
  return r.map((x) => x.payload as { action: string; metadata?: Record<string, unknown> });
}

describe("server-side maximum (GAP-HR-LEAVE-ALLOCATE-03)", () => {
  it("refuses totalDays above the type's maxDays (422 EXCEEDS_TYPE_MAX) and writes nothing", async () => {
    const r = await post({ totalDays: 40 });
    expect(r.statusCode).toBe(422);
    expect(JSON.parse(r.body).code).toBe("EXCEEDS_TYPE_MAX");
    await drain();
    expect(await rows("2026-27")).toHaveLength(0);
  });

  it("an override without a reason is refused (REASON_REQUIRED)", async () => {
    const r = await post({ totalDays: 40, exceedMax: true });
    expect(r.statusCode).toBe(422);
    expect(JSON.parse(r.body).code).toBe("REASON_REQUIRED");
  });

  it("an override WITH a reason is allowed, and the audit event records the reason and that it exceeded the maximum", async () => {
    const r = await post({ totalDays: 20, exceedMax: true, reason: "Special grant for deputation overseas" });
    expect(r.statusCode).toBe(202);
    await drain();
    const [row] = await rows("2026-27");
    expect(row).toMatchObject({ total_days: 20, balance_days: 20 });
    const a = (await audits(JSON.parse(r.body).id)).find((x) => x.action === "allocate")!;
    expect(a.metadata).toMatchObject({ reason: "Special grant for deputation overseas", exceededTypeMax: true, totalDays: 20, employeeId: EMP });
  });

  it("only hr_admin or super_admin may override the maximum: an hr_officer is 403 even with a reason, and nothing is written", async () => {
    const r = await post({ totalDays: 40, exceedMax: true, reason: "Special grant", fy: "2031-32" }, ["hr_officer"]);
    expect(r.statusCode).toBe(403);
    await drain();
    expect(await rows("2031-32")).toHaveLength(0);
    // super_admin may; hr_officer still allocates within the cap
    expect((await post({ totalDays: 40, exceedMax: true, reason: "Special grant", fy: "2031-32" }, ["super_admin"])).statusCode).toBe(202);
    expect((await post({ totalDays: 5, fy: "2032-33" }, ["hr_officer"])).statusCode).toBe(202);
  });

  it("at or under the maximum needs no override; a type with no cap (0) never triggers it", async () => {
    const ok = await post({ totalDays: 12, fy: "2027-28" });
    expect(ok.statusCode).toBe(202);
    const big = await post({ totalDays: 400, leaveTypeId: UNCAPPED });
    expect(big.statusCode).toBe(202);
  });

  it("an unknown leave type is refused (422), not silently accepted", async () => {
    const r = await post({ totalDays: 5, leaveTypeId: "facade00-a110-4000-8000-0000000000ee" });
    expect(r.statusCode).toBe(422);
    expect(JSON.parse(r.body).code).toBe("UNKNOWN_LEAVE_TYPE");
  });
});

describe("optional reason (GAP-HR-LEAVE-ALLOCATE-01)", () => {
  it("is optional for API callers, and when given is recorded in the audit event (not exceeded)", async () => {
    const plain = await post({ totalDays: 5, fy: "2028-29" });
    expect(plain.statusCode).toBe(202);
    const withReason = await post({ totalDays: 6, fy: "2029-30", reason: "Annual entitlement" });
    expect(withReason.statusCode).toBe(202);
    await drain();
    const a = (await audits(JSON.parse(withReason.body).id)).find((x) => x.action === "allocate")!;
    expect(a.metadata).toMatchObject({ reason: "Annual entitlement", exceededTypeMax: false });
    const b = (await audits(JSON.parse(plain.body).id)).find((x) => x.action === "allocate")!;
    expect(b.metadata).toMatchObject({ reason: null });
  });

  it("rejects an empty or over-long reason at the boundary", async () => {
    expect((await post({ totalDays: 5, fy: "2030-31", reason: "   " })).statusCode).toBe(400);
    expect((await post({ totalDays: 5, fy: "2030-31", reason: "x".repeat(501) })).statusCode).toBe(400);
  });
});
