/**
 * S8-G3 -- organisation-defined leave types, real Postgres under FORCE RLS (NOBYPASSRLS role).
 *
 * Covers: the safe-deactivate flow (dry run, maker-checker, ends allocations, audit trail),
 * blockers, RLS isolation between tenants, retire-unused, the per-tenant resolver switch, and
 * that the row-based resolver resolves a tenant-defined type for a `contract` employee while the
 * default (switch OFF) path is untouched.
 *
 * Realistic DIC-style data: PL / SL "Project Contract Staff" types allocated to many staff.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { registerLeaveConsumers } from "../modules/leave/consumer.js";

registerLeaveConsumers(queue);
const drain = (): Promise<void> => (queue as unknown as { drain: () => Promise<void> }).drain();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER = randomUUID();
const MAKER = randomUUID();
const CHECKER = randomUUID();
const asTenant = <T>(t: string, fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> => withRawTenantGuc(sqlClient, t, fn);
const as = (sub: string, tid = TENANT, roles = ["hr_admin"]) => ({ authorization: `Bearer ${signToken({ sub, tid, roles, sid: "s-g3" }, SECRET)}` });
const maker = (tid = TENANT) => as(MAKER, tid);
const checker = (tid = TENANT) => as(CHECKER, tid);

const T = { CL: randomUUID(), PL: randomUUID(), SL: randomUUID(), WFH: randomUUID(), PRJ: randomUUID(), OPEN: randomUUID() };
const EMP_NAMES = ["Ananya Iyer", "Rohit Sharma", "Meera Nair", "Kunal Verma", "Divya Menon"];
const emps = EMP_NAMES.map(() => randomUUID());
const allocPL: string[] = [];
const allocSL: string[] = [];
let app: Awaited<ReturnType<typeof buildApp>>;

const wipe = async () => {
  for (const t of [TENANT, OTHER]) {
    await asTenant(t, async (tx) => {
      await tx`DELETE FROM leave.hrms_leave_type_changes WHERE tenant_id = ${t}`;
      await tx`DELETE FROM leave.hrms_leave_apps WHERE tenant_id = ${t}`;
      await tx`DELETE FROM leave.hrms_leave_policy_rules WHERE tenant_id = ${t}`;
      await tx`DELETE FROM leave.hrms_leave_allocs WHERE tenant_id = ${t}`;
      await tx`DELETE FROM leave.hrms_leave_types WHERE tenant_id = ${t}`;
      await tx`DELETE FROM leave.hrms_leave_tenant_config WHERE tenant_id = ${t}`;
      await tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${t}`;
    });
  }
};

beforeAll(async () => {
  app = await buildApp();
  await wipe();
  await asTenant(TENANT, async (tx) => {
    const ty = (id: string, code: string, name: string, sys: string | null) =>
      tx`INSERT INTO leave.hrms_leave_types (id, tenant_id, code, name, max_days, system_code, created_by, updated_by) VALUES (${id}, ${TENANT}, ${code}, ${name}, 12, ${sys}, ${MAKER}, ${MAKER})`;
    await ty(T.CL, "CL", "Casual Leave", "CL");
    await ty(T.PL, "PL", "Paid Leave (Project Contract Staff)", "PL");
    await ty(T.SL, "SL", "Sick Leave (Project Contract Staff)", "SL");
    await ty(T.WFH, "WFH", "Work From Home Day", null);
    await ty(T.PRJ, "PRJ", "Project Leave", null);
    await ty(T.OPEN, "OPN", "Optional Holiday", null);
    for (let i = 0; i < emps.length; i++) {
      await tx`INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, employee_type, status, created_by, updated_by)
        VALUES (${emps[i]!}, ${TENANT}, ${`DIC-${1001 + i}`}, ${EMP_NAMES[i]!}, ${randomUUID()}, ${randomUUID()}, '2022-04-01', 'contract', 'confirmed', ${MAKER}, ${MAKER})`;
      const a = randomUUID(); const b = randomUUID();
      allocPL.push(a); allocSL.push(b);
      await tx`INSERT INTO leave.hrms_leave_allocs (id, tenant_id, employee_id, leave_type_id, fy, total_days, balance_days, created_by, updated_by) VALUES (${a}, ${TENANT}, ${emps[i]!}, ${T.PL}, '2026-27', 12, 10, ${MAKER}, ${MAKER})`;
      await tx`INSERT INTO leave.hrms_leave_allocs (id, tenant_id, employee_id, leave_type_id, fy, total_days, balance_days, created_by, updated_by) VALUES (${b}, ${TENANT}, ${emps[i]!}, ${T.SL}, '2026-27', 8, 8, ${MAKER}, ${MAKER})`;
    }
    // CL allocation must be untouched by the PL/SL clean-up.
    await tx`INSERT INTO leave.hrms_leave_allocs (id, tenant_id, employee_id, leave_type_id, fy, total_days, balance_days, created_by, updated_by) VALUES (${randomUUID()}, ${TENANT}, ${emps[0]!}, ${T.CL}, '2026-27', 8, 8, ${MAKER}, ${MAKER})`;
    // An in-flight application on the PRJ type blocks its deactivation.
    const prjAlloc = randomUUID();
    await tx`INSERT INTO leave.hrms_leave_allocs (id, tenant_id, employee_id, leave_type_id, fy, total_days, balance_days, created_by, updated_by) VALUES (${prjAlloc}, ${TENANT}, ${emps[1]!}, ${T.PRJ}, '2026-27', 5, 5, ${MAKER}, ${MAKER})`;
    await tx`INSERT INTO leave.hrms_leave_apps (id, tenant_id, employee_id, leave_type_id, alloc_id, from_date, to_date, days_applied, status, created_by, updated_by) VALUES (${randomUUID()}, ${TENANT}, ${emps[1]!}, ${T.PRJ}, ${prjAlloc}, '2026-12-14', '2026-12-15', 2, 'pending', ${MAKER}, ${MAKER})`;
  });
});

afterAll(async () => { await wipe(); await app.close(); await sqlClient.end(); });

const typeRow = (id: string) => asTenant(TENANT, async (tx) => (await tx`SELECT is_active, version FROM leave.hrms_leave_types WHERE id = ${id}`)[0]!);
const allocStatuses = (typeId: string) => asTenant(TENANT, (tx) => tx`SELECT status, ended_on::text AS ended_on, ended_reason, ended_by FROM leave.hrms_leave_allocs WHERE leave_type_id = ${typeId}`);
const auditActions = (resourceId: string) => asTenant(TENANT, (tx) => tx`SELECT payload->>'action' AS action, payload->>'outcome' AS outcome, payload->'metadata' AS md FROM _outbox.messages WHERE tenant_id = ${TENANT} AND topic = 'audit.event.record' AND payload->>'resourceId' = ${resourceId} ORDER BY created_at`);

describe("S8-G3 safe deactivation of a leave type with live allocations", () => {
  it("dry run reports the impact and writes nothing", async () => {
    const r = await app.inject({ method: "POST", url: `/v1/hrms/leave-types/${T.PL}/deactivate`, headers: maker(), payload: { reason: "Dead type, no staff can use it", dryRun: true } });
    expect(r.statusCode).toBe(200);
    expect(r.json().impact).toMatchObject({ activeAllocations: 5, employeesWithAllocations: 5, balanceDaysOnLiveAllocations: 50, openApplications: 0 });
    expect(r.json().blockers).toEqual([]);
    expect((await typeRow(T.PL)).is_active).toBe(true);
    expect((await allocStatuses(T.PL)).every((a) => a.status === "active")).toBe(true);
  });

  it("the maker's request deactivates NOTHING until a different admin approves", async () => {
    const r = await app.inject({ method: "POST", url: `/v1/hrms/leave-types/${T.PL}/deactivate`, headers: maker(), payload: { reason: "Dead type, no staff can use it" } });
    expect(r.statusCode).toBe(202);
    await drain();
    const list = await app.inject({ method: "GET", url: "/v1/hrms/leave-type-changes", headers: checker() });
    expect(list.json().data).toHaveLength(1);
    expect(list.json().data[0]).toMatchObject({ leaveTypeCode: "PL", status: "pending", requestedBy: MAKER });
    expect((await typeRow(T.PL)).is_active).toBe(true);
    expect((await allocStatuses(T.PL)).every((a) => a.status === "active")).toBe(true);
    // a second request while one is pending is refused up front
    const dup = await app.inject({ method: "POST", url: `/v1/hrms/leave-types/${T.PL}/deactivate`, headers: checker(), payload: { reason: "Another attempt at the same" } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("CHANGE_ALREADY_PENDING");
  });

  it("maker-checker: the requester cannot approve or reject their own request (403), and the consumer re-asserts it", async () => {
    const id = (await app.inject({ method: "GET", url: "/v1/hrms/leave-type-changes", headers: maker() })).json().data[0].id as string;
    const self = await app.inject({ method: "POST", url: `/v1/hrms/leave-type-changes/${id}/approve`, headers: maker(), payload: {} });
    expect(self.statusCode).toBe(403);
    expect(self.json().code).toBe("SELF_APPROVAL_FORBIDDEN");
    // Bypass the route: publish the decide command as the maker. The consumer must still refuse.
    await queue.publish("hrms.leave_type.change_decide", {
      messageId: randomUUID(), type: "hrms.leave_type.change_decide", tenantId: TENANT, actorId: MAKER, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { requestId: id, decision: "approve", note: null },
    }).catch(() => undefined);
    await drain().catch(() => undefined);
    expect((await typeRow(T.PL)).is_active).toBe(true);
    expect((await allocStatuses(T.PL)).every((a) => a.status === "active")).toBe(true);
  });

  it("a second admin approves: the type is deactivated, ALL its live allocations are ended, CL is untouched, and it is audited", async () => {
    const id = (await app.inject({ method: "GET", url: "/v1/hrms/leave-type-changes", headers: checker() })).json().data[0].id as string;
    const ok = await app.inject({ method: "POST", url: `/v1/hrms/leave-type-changes/${id}/approve`, headers: checker(), payload: { note: "Confirmed with DIC HR" } });
    expect(ok.statusCode).toBe(202);
    await drain();
    expect((await typeRow(T.PL)).is_active).toBe(false);
    const ended = await allocStatuses(T.PL);
    expect(ended).toHaveLength(5);
    for (const a of ended) {
      expect(a.status).toBe("ended");
      expect(a.ended_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(a.ended_reason).toContain(id);
      expect(a.ended_by).toBe(CHECKER);
    }
    // history is preserved: rows still exist; SL (not requested) and CL untouched
    expect((await allocStatuses(T.SL)).every((a) => a.status === "active")).toBe(true);
    const cl = await asTenant(TENANT, (tx) => tx`SELECT status FROM leave.hrms_leave_allocs WHERE leave_type_id = ${T.CL}`);
    expect(cl.every((a) => a.status === "active")).toBe(true);

    const changes = await app.inject({ method: "GET", url: "/v1/hrms/leave-type-changes?status=approved", headers: checker() });
    expect(changes.json().data[0]).toMatchObject({ status: "approved", decidedBy: CHECKER, appliedSummary: { endedAllocations: 5, employees: 5, balanceDaysForfeited: 50 } });

    const trail = await auditActions(T.PL);
    expect(trail.map((t) => t.action)).toEqual(expect.arrayContaining(["request_deactivate", "deactivate"]));
    const done = trail.find((t) => t.action === "deactivate")!;
    expect(done.outcome).toBe("success");
    expect(done.md).toMatchObject({ requestedBy: MAKER, decidedBy: CHECKER, endedAllocations: 5, employees: 5, balanceDaysForfeited: 50 });

    // a replay of the decision is a no-op (idempotent)
    const again = await app.inject({ method: "POST", url: `/v1/hrms/leave-type-changes/${id}/approve`, headers: checker(), payload: {} });
    expect(again.statusCode).toBe(409);
  });

  it("an inactive type disappears from the apply pickers and balances; the admin list still shows it", async () => {
    const pick = await app.inject({ method: "GET", url: "/v1/hrms/leave-types", headers: maker() });
    expect(pick.json().data.map((t: { code: string }) => t.code)).not.toContain("PL");
    expect(pick.json().data.map((t: { code: string }) => t.code)).toContain("SL");
    const admin = await app.inject({ method: "GET", url: "/v1/hrms/admin/leave-types", headers: maker() });
    const pl = admin.json().data.find((t: { code: string }) => t.code === "PL");
    expect(pl).toMatchObject({ isActive: false, activeAllocations: 0 });
    const balances = await app.inject({ method: "GET", url: `/v1/hrms/leave-allocations?employeeId=${emps[0]}`, headers: maker() });
    const typeIds = balances.json().data.map((a: { leaveTypeId: string }) => a.leaveTypeId);
    expect(typeIds).not.toContain(T.PL);
    expect(typeIds).toContain(T.SL);
  });

  it("applying on the deactivated type, or on an ended allocation, is refused", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/hrms/leave-requests/preview", headers: maker(), payload: { employeeId: emps[0], leaveTypeId: T.PL, allocId: allocPL[0], fromDate: "2026-12-16", toDate: "2026-12-16", daysApplied: 1 } });
    expect(r.statusCode).toBe(200);
    expect(r.json().valid).toBe(false);
    expect(r.json().violations[0].code).toBe("ALLOCATION_ENDED");
    // An inactive type whose allocation is still live (e.g. deactivated outside this flow) is refused on its own.
    await asTenant(TENANT, (tx) => tx`UPDATE leave.hrms_leave_types SET is_active = false WHERE id = ${T.SL}`);
    try {
      const r2 = await app.inject({ method: "POST", url: "/v1/hrms/leave-requests/preview", headers: maker(), payload: { employeeId: emps[0], leaveTypeId: T.SL, allocId: allocSL[0], fromDate: "2026-12-22", toDate: "2026-12-22", daysApplied: 1 } });
      expect(r2.json().violations[0].code).toBe("LEAVE_TYPE_INACTIVE");
    } finally {
      await asTenant(TENANT, (tx) => tx`UPDATE leave.hrms_leave_types SET is_active = true WHERE id = ${T.SL}`);
    }
  });

  it("a reject closes the request without touching the type", async () => {
    const r1 = await app.inject({ method: "POST", url: `/v1/hrms/leave-types/${T.SL}/deactivate`, headers: maker(), payload: { reason: "Trying SL deactivation" } });
    expect(r1.statusCode).toBe(202);
    await drain();
    const id = (await app.inject({ method: "GET", url: "/v1/hrms/leave-type-changes", headers: checker() })).json().data[0].id as string;
    const bad = await app.inject({ method: "POST", url: `/v1/hrms/leave-type-changes/${id}/reject`, headers: checker(), payload: {} });
    expect(bad.statusCode).toBe(400); // a rejection needs a note
    const rj = await app.inject({ method: "POST", url: `/v1/hrms/leave-type-changes/${id}/reject`, headers: checker(), payload: { note: "SL is still needed" } });
    expect(rj.statusCode).toBe(202);
    await drain();
    expect((await typeRow(T.SL)).is_active).toBe(true);
    expect((await allocStatuses(T.SL)).every((a) => a.status === "active")).toBe(true);
  });

  it("open applications block a deactivation (409) and the dry run says why", async () => {
    const dry = await app.inject({ method: "POST", url: `/v1/hrms/leave-types/${T.PRJ}/deactivate`, headers: maker(), payload: { reason: "Retire project leave", dryRun: true } });
    expect(dry.json().blockers[0].code).toBe("OPEN_APPLICATIONS");
    const real = await app.inject({ method: "POST", url: `/v1/hrms/leave-types/${T.PRJ}/deactivate`, headers: maker(), payload: { reason: "Retire project leave" } });
    expect(real.statusCode).toBe(409);
    expect(real.json().code).toBe("OPEN_APPLICATIONS");
  });

  it("an application filed AFTER the request blocks the approval (consumer re-counts) and the request is closed as rejected", async () => {
    // WFH has no allocations; raise a request, then file a pending application before approval.
    const r = await app.inject({ method: "POST", url: `/v1/hrms/leave-types/${T.WFH}/deactivate`, headers: maker(), payload: { reason: "Retire WFH day type" } });
    expect(r.statusCode).toBe(202);
    await drain();
    const id = (await app.inject({ method: "GET", url: "/v1/hrms/leave-type-changes", headers: checker() })).json().data.find((c: { leaveTypeCode: string }) => c.leaveTypeCode === "WFH").id as string;
    await asTenant(TENANT, async (tx) => {
      const al = randomUUID();
      await tx`INSERT INTO leave.hrms_leave_allocs (id, tenant_id, employee_id, leave_type_id, fy, total_days, balance_days, created_by, updated_by) VALUES (${al}, ${TENANT}, ${emps[2]!}, ${T.WFH}, '2026-27', 6, 6, ${MAKER}, ${MAKER})`;
      await tx`INSERT INTO leave.hrms_leave_apps (id, tenant_id, employee_id, leave_type_id, alloc_id, from_date, to_date, days_applied, status, created_by, updated_by) VALUES (${randomUUID()}, ${TENANT}, ${emps[2]!}, ${T.WFH}, ${al}, '2026-12-21', '2026-12-21', 1, 'pending', ${MAKER}, ${MAKER})`;
    });
    await app.inject({ method: "POST", url: `/v1/hrms/leave-type-changes/${id}/approve`, headers: checker(), payload: {} });
    await drain();
    expect((await typeRow(T.WFH)).is_active).toBe(true);
    const done = await app.inject({ method: "GET", url: "/v1/hrms/leave-type-changes?status=rejected", headers: checker() });
    expect(done.json().data.some((c: { id: string; decisionNote: string }) => c.id === id && /blocked at approval/.test(c.decisionNote))).toBe(true);
  });

  it("ending one allocation needs a reason, is audited, and an ended one cannot be ended again", async () => {
    const noReason = await app.inject({ method: "POST", url: `/v1/hrms/leave-allocations/${allocSL[4]}/end`, headers: maker(), payload: {} });
    expect(noReason.statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: `/v1/hrms/leave-allocations/${allocSL[4]}/end`, headers: maker(), payload: { reason: "Divya Menon left the project" } });
    expect(ok.statusCode).toBe(202);
    await drain();
    const row = (await asTenant(TENANT, (tx) => tx`SELECT status, ended_reason FROM leave.hrms_leave_allocs WHERE id = ${allocSL[4]!}`))[0]!;
    expect(row).toMatchObject({ status: "ended", ended_reason: "Divya Menon left the project" });
    expect((await auditActions(allocSL[4]!)).map((a) => a.action)).toContain("end");
    const again = await app.inject({ method: "POST", url: `/v1/hrms/leave-allocations/${allocSL[4]}/end`, headers: maker(), payload: { reason: "Divya Menon left the project" } });
    expect(again.statusCode).toBe(409);
  });

  it("retire-unused: dry run lists only types with no applications and no live allocations; applying raises maker-checker requests", async () => {
    const dry = await app.inject({ method: "POST", url: "/v1/hrms/leave-types/retire-unused", headers: maker(), payload: {} });
    expect(dry.statusCode).toBe(200);
    expect(dry.json().candidates.map((c: { code: string }) => c.code)).toEqual(["OPN"]);
    const noReason = await app.inject({ method: "POST", url: "/v1/hrms/leave-types/retire-unused", headers: maker(), payload: { dryRun: false } });
    expect(noReason.statusCode).toBe(422);
    const go = await app.inject({ method: "POST", url: "/v1/hrms/leave-types/retire-unused", headers: maker(), payload: { dryRun: false, reason: "Unused optional-holiday type" } });
    expect(go.statusCode).toBe(202);
    await drain();
    expect((await typeRow(T.OPEN)).is_active).toBe(true); // still needs a checker
    const pend = (await app.inject({ method: "GET", url: "/v1/hrms/leave-type-changes", headers: checker() })).json().data.find((c: { leaveTypeCode: string }) => c.leaveTypeCode === "OPN");
    expect(pend.status).toBe("pending");
  });

  it("RLS: another tenant sees none of this and cannot decide it", async () => {
    const pend = (await app.inject({ method: "GET", url: "/v1/hrms/leave-type-changes?status=all", headers: checker() })).json().data;
    expect(pend.length).toBeGreaterThan(0);
    const other = await app.inject({ method: "GET", url: "/v1/hrms/leave-type-changes?status=all", headers: as(CHECKER, OTHER) });
    expect(other.json().data).toEqual([]);
    const steal = await app.inject({ method: "POST", url: `/v1/hrms/leave-type-changes/${pend[0].id}/approve`, headers: as(CHECKER, OTHER), payload: {} });
    expect(steal.statusCode).toBe(404);
    const otherTypes = await app.inject({ method: "GET", url: "/v1/hrms/admin/leave-types", headers: as(CHECKER, OTHER) });
    expect(otherTypes.json().data).toEqual([]);
    const rls = await sqlClient`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'leave.hrms_leave_type_changes'::regclass`;
    expect(rls[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("role guard: an employee or hr_officer cannot deactivate, edit, or approve", async () => {
    for (const roles of [["employee"], ["hr_officer"]]) {
      const h = as(randomUUID(), TENANT, roles);
      expect((await app.inject({ method: "POST", url: `/v1/hrms/leave-types/${T.CL}/deactivate`, headers: h, payload: { reason: "Not allowed to do this" } })).statusCode).toBe(403);
      expect((await app.inject({ method: "PATCH", url: `/v1/hrms/leave-types/${T.CL}`, headers: h, payload: { name: "x" } })).statusCode).toBe(403);
      expect((await app.inject({ method: "PUT", url: "/v1/hrms/leave-config/custom-rules", headers: h, payload: { enabled: true } })).statusCode).toBe(403);
    }
  });
});

describe("S8-G3 tenant-defined leave type resolved from rows (switch ON) vs the untouched default (switch OFF)", () => {
  const preview = (leaveTypeId: string, allocId: string, employeeId: string, day = "2026-12-22") =>
    app.inject({ method: "POST", url: "/v1/hrms/leave-requests/preview", headers: maker(), payload: { employeeId, leaveTypeId, allocId, fromDate: day, toDate: day, daysApplied: 1 } });
  let wfhAlloc: string;
  let optAlloc: string;
  beforeAll(async () => {
    wfhAlloc = (await asTenant(TENANT, (tx) => tx`SELECT id FROM leave.hrms_leave_allocs WHERE leave_type_id = ${T.WFH} AND employee_id = ${emps[2]!}`))[0]!.id as string;
    // an allocation on the custom OPEN type for a contract employee
    optAlloc = randomUUID();
    await asTenant(TENANT, async (tx) => {
      await tx`INSERT INTO leave.hrms_leave_allocs (id, tenant_id, employee_id, leave_type_id, fy, total_days, balance_days, created_by, updated_by) VALUES (${optAlloc}, ${TENANT}, ${emps[3]!}, ${T.OPEN}, '2026-27', 2, 2, ${MAKER}, ${MAKER})`;
    });
  });

  it("switch OFF (default): the pre-existing behaviour -- a code outside the catalogue is balance-checked only", async () => {
    const g = await app.inject({ method: "GET", url: "/v1/hrms/leave-config/custom-rules", headers: maker() });
    expect(g.json()).toEqual({ enabled: false });
    const r = await preview(T.OPEN, optAlloc, emps[3]!);
    expect(r.json()).toMatchObject({ valid: true, engineApplied: false });
  });

  it("switch ON: a tenant type with NO rule and NO built-in is refused with NO_LEAVE_RULE", async () => {
    const put = await app.inject({ method: "PUT", url: "/v1/hrms/leave-config/custom-rules", headers: maker(), payload: { enabled: true } });
    expect(put.statusCode).toBe(202);
    await drain();
    expect((await app.inject({ method: "GET", url: "/v1/hrms/leave-config/custom-rules", headers: maker() })).json()).toEqual({ enabled: true });
    const r = await preview(T.OPEN, optAlloc, emps[3]!);
    expect(r.json().valid).toBe(false);
    expect(r.json().violations[0].message).toMatch(/NO_LEAVE_RULE/);
  });

  it("switch ON: a rule saved for `contractual` serves a `contract` employee (alias) and its limits apply", async () => {
    await asTenant(TENANT, (tx) => tx`INSERT INTO leave.hrms_leave_policy_rules (id, tenant_id, leave_type_id, employee_type, max_days_per_year, max_continuous_days, count_method, created_by, updated_by)
      VALUES (${randomUUID()}, ${TENANT}, ${T.OPEN}, 'contractual', 2, 1, 'calendar', ${MAKER}, ${MAKER})`);
    const one = await preview(T.OPEN, optAlloc, emps[3]!);
    expect(one.json()).toMatchObject({ valid: true, engineApplied: true, computedDays: 1 });
    const two = await app.inject({ method: "POST", url: "/v1/hrms/leave-requests/preview", headers: maker(), payload: { employeeId: emps[3], leaveTypeId: T.OPEN, allocId: optAlloc, fromDate: "2026-12-22", toDate: "2026-12-23", daysApplied: 2 } });
    expect(two.json().valid).toBe(false);
    expect(two.json().violations[0].message).toMatch(/maximum continuous/i);
  });

  it("switch ON: probation is a rule property -- a probationer is refused unless the rule allows it", async () => {
    await asTenant(TENANT, (tx) => tx`UPDATE employee.hrms_employees SET status = 'probation' WHERE id = ${emps[3]!}`);
    const refused = await preview(T.OPEN, optAlloc, emps[3]!);
    expect(refused.json().valid).toBe(false);
    expect(refused.json().violations[0].message).toMatch(/probation/i);
    await asTenant(TENANT, (tx) => tx`UPDATE leave.hrms_leave_policy_rules SET allowed_in_probation = true WHERE leave_type_id = ${T.OPEN}`);
    expect((await preview(T.OPEN, optAlloc, emps[3]!)).json().valid).toBe(true);
  });

  it("switch ON: a built-in type (system_code CL) still resolves from the catalogue with no tenant rule", async () => {
    const clAlloc = (await asTenant(TENANT, (tx) => tx`SELECT id FROM leave.hrms_leave_allocs WHERE leave_type_id = ${T.CL}`))[0]!.id as string;
    const r = await preview(T.CL, clAlloc, emps[0]!);
    expect(r.json()).toMatchObject({ valid: true, engineApplied: true });
  });

  it("switch OFF again restores the old path exactly", async () => {
    await app.inject({ method: "PUT", url: "/v1/hrms/leave-config/custom-rules", headers: maker(), payload: { enabled: false } });
    await drain();
    expect((await preview(T.OPEN, optAlloc, emps[3]!)).json()).toMatchObject({ engineApplied: false });
  });
});
