/**
 * GAP-PAYROLL-PAY-GROUPS-03 (membership) end to end against a REAL Postgres
 * (migrated through 0084, run as the non-superuser payroll_svc so FORCE RLS
 * applies), through buildApp() and the real consumers (memory queue):
 *  - effective-dated membership: assign / move / end / bulk, overlap refused
 *    (route, planner AND the DB trigger / unique index), one audit event per batch
 *  - pay-group runs include exactly the members whose assignment covers the month
 *  - an employee cannot be in two non-cancelled regular runs for one period,
 *    including under concurrency
 *  - deactivation is blocked while members / in-flight runs exist
 *  - tenants with no pay groups run exactly as before
 *
 * Requires DATABASE_URL pointing at a disposable, migrated instance.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return {
    ...actual,
    fetchPayrollInput: vi.fn(),
    fetchEmployeeSummaries: vi.fn(),
    verifyEmployeeExists: vi.fn(async () => true),
    searchEmployeeSummaries: vi.fn(),
    searchEmployeeSummariesStrict: vi.fn(),
  };
});
import { fetchPayrollInput, fetchEmployeeSummaries, searchEmployeeSummaries, searchEmployeeSummariesStrict } from "../src/shared/hrms-client.js";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerPayrollConsumers } from "../src/modules/payroll/consumer.js";
import { COMMANDS } from "../src/topics.js";
import * as fin03Commands from "../src/modules/payroll/fin03-commands.js";
import { claimRunEmployees, findDoubleRunEmployees, resolveMonthMembers } from "../src/modules/payroll/pay-group-repo.js";
import type { FastifyInstance } from "fastify";
import type { RequestContext } from "@civitasone/types";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const TENANT2 = randomUUID(); // no pay groups at all: legacy behaviour
const ACTOR = randomUUID();
const DEPT = randomUUID();
const SUFFIX = randomUUID().slice(0, 6);
const D1 = `D1-${SUFFIX}`;
const D2 = `D2-${SUFFIX}`;

type Row = Record<string, unknown>;
const E = Array.from({ length: 7 }, (_, i) => ({ id: randomUUID(), no: `PG-${SUFFIX}-00${i + 1}` }));
const [E1, E2, E3, E4, E5, E6, E7] = E as [typeof E[number], typeof E[number], typeof E[number], typeof E[number], typeof E[number], typeof E[number], typeof E[number]];

const hdr = (roles = ["payroll_admin"], tenant = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles, sid: "pgm" }, SECRET, 3600)}`,
  "content-type": "application/json",
});
const asTenant = <T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>, tenant = TENANT) =>
  runWithTenant(tenant, () => db.transaction(fn));
const q = async (s: ReturnType<typeof sql>, tenant = TENANT) => (await asTenant((tx) => tx.execute(s), tenant)) as unknown as Row[];

async function until<T>(fn: () => Promise<T>, pred: (v: T) => boolean, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  let v = await fn();
  while (!pred(v) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 60));
    v = await fn();
  }
  return v;
}
const settleMs = (ms = 400) => new Promise((r) => setTimeout(r, ms));

const employee = (e: { id: string; no: string }) => ({
  id: e.id, employeeNo: e.no, fullName: e.no, basicMinor: "5000000", dateOfJoining: "2020-01-01", payStructureId: null,
  bankAccountNo: null, bankIfsc: null, pan: null, uan: null, pran: null, cityClass: "X", taxRegime: "new",
  departmentId: DEPT, pensionScheme: "NPS", paymentRoute: "payroll", eligibleForPayroll: true,
  statutoryPf: true, statutoryEsi: true, statutoryNps: true,
});
const FEED = E.map(employee);

let app: FastifyInstance;
const STRUCTURE = randomUUID();
const STRUCTURE2 = randomUUID();

async function post(url: string, payload: unknown, roles?: string[], tenant = TENANT) {
  return app.inject({ method: "POST", url, headers: hdr(roles, tenant), payload: payload as object });
}
async function patch(url: string, payload: unknown) {
  return app.inject({ method: "PATCH", url, headers: hdr(), payload: payload as object });
}
const body = (r: { json: () => unknown }) => r.json() as Record<string, any>;

async function createDdo(code: string) {
  expect((await post("/v1/payroll/ddos", { ddoCode: code, name: `Treasury ${code}` })).statusCode).toBe(202);
  await until(() => q(sql`SELECT 1 FROM payroll.payroll_ddos WHERE ddo_code = ${code}`), (r) => r.length > 0);
}
async function createGroup(name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await post("/v1/payroll/pay-groups", { name, frequency: "monthly", payDayOfMonth: 28, ...extra });
  expect(res.statusCode).toBe(202);
  const id = body(res).id as string;
  await until(() => q(sql`SELECT 1 FROM payroll.pay_groups WHERE id = ${id}::uuid`), (r) => r.length > 0);
  return id;
}
async function assign(groupId: string, e: { no: string }, effectiveFrom: string, reason = "Establishment order 12/2026") {
  return post(`/v1/payroll/pay-groups/${groupId}/members`, { employeeNo: e.no, effectiveFrom, reason });
}
const assignments = (emp: string) => q(sql`
  SELECT pay_group_id::text, effective_from::text AS effective_from, effective_to::text AS effective_to
    FROM payroll.employee_pay_group_assignments WHERE employee_id = ${emp}::uuid ORDER BY effective_from`);

async function runSettled(runId: string): Promise<{ status: string; last_error: string | null }> {
  const deadline = Date.now() + 40_000;
  for (;;) {
    await settleMs(250);
    const [run] = await q(sql`SELECT status, last_error FROM payroll.payroll_runs WHERE id = ${runId}::uuid`);
    const regs = await q(sql`SELECT 1 FROM payroll.payroll_register WHERE run_id = ${runId}::uuid LIMIT 1`);
    if (run?.status === "failed" || regs.length > 0) return run as { status: string; last_error: string | null };
    if (Date.now() > deadline) throw new Error(`run ${runId} did not settle: ${JSON.stringify(run)}`);
  }
}
const slipNos = async (runId: string, tenant = TENANT) =>
  (await q(sql`SELECT employee_no FROM payroll.payroll_slips WHERE run_id = ${runId}::uuid ORDER BY employee_no`, tenant)).map((r) => r.employee_no as string);
const noList = (...es: Array<{ no: string }>) => es.map((e) => e.no).sort();

const auditsFor = (resourceId: string) => q(sql`
  SELECT payload FROM _outbox.messages WHERE topic = 'audit.event.record' AND payload->>'resourceId' = ${resourceId} ORDER BY created_at`);

let GA = "", GB = "", GC = "", GD = "", GE = "";
let decRunIds: string[] = [];

// A directory far larger than hrms's 2000-row unfiltered feed cap.
type Summary = { fullName: string; departmentName: string; employeeNo: string | null };
const DIRECTORY = new Map<string, Summary>(E.map((e) => [e.id, { fullName: e.no, departmentName: "Treasury", employeeNo: e.no }]));
for (let i = 0; i < 2500; i++) DIRECTORY.set(randomUUID(), { fullName: `Filler ${i}`, departmentName: "Other", employeeNo: `FILL-${SUFFIX}-${i}` });
const BIG = { id: randomUUID(), no: `BIG-${SUFFIX}-A` };
const BIG2 = { id: randomUUID(), no: `BIG-${SUFFIX}-B` };
DIRECTORY.set(BIG.id, { fullName: BIG.no, departmentName: "Late", employeeNo: BIG.no });
DIRECTORY.set(BIG2.id, { fullName: BIG2.no, departmentName: "Late", employeeNo: BIG2.no });
const filterDirectory = (f: { q?: string; ids?: string[] }) => new Map([...DIRECTORY].filter(([id, v]) =>
  (f.ids && f.ids.length > 0 ? f.ids.includes(id) : true) &&
  (f.q ? (v.employeeNo ?? "").toLowerCase().includes(f.q.toLowerCase()) || v.fullName.toLowerCase().includes(f.q.toLowerCase()) : true)));

beforeAll(async () => {
  vi.mocked(fetchPayrollInput).mockResolvedValue({ month: "2026-11", employees: FEED, lopDays: {}, overtimeHours: {} } as unknown as Awaited<ReturnType<typeof fetchPayrollInput>>);
  // The unfiltered feed is capped at 2000 rows: BIG / BIG2 sit beyond it.
  vi.mocked(fetchEmployeeSummaries).mockResolvedValue(new Map([...DIRECTORY].slice(0, 2000)));
  vi.mocked(searchEmployeeSummaries).mockImplementation(async (_t, f) => filterDirectory(f));
  vi.mocked(searchEmployeeSummariesStrict).mockImplementation(async (_t, f) => filterDirectory(f));
  const { verifyEmployeeExists } = await import("../src/shared/hrms-client.js");
  vi.mocked(verifyEmployeeExists).mockImplementation(async (_t, id) => DIRECTORY.has(id));
  const rawSubscribe = queue.subscribe.bind(queue);
  (queue as unknown as { subscribe: typeof queue.subscribe }).subscribe = ((topic: string, handler: (msg: { tenantId: string }) => Promise<void>) =>
    rawSubscribe(topic, (msg: { tenantId: string }) => runWithTenant(msg.tenantId, () => handler(msg)))) as unknown as typeof queue.subscribe;
  registerPayrollConsumers(queue);
  await queue.start();
  app = await buildApp();
  for (const [t, st] of [[TENANT, STRUCTURE], [TENANT2, STRUCTURE2]] as const) {
    await asTenant(async (tx) => {
      await tx.execute(sql`INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps) VALUES (${t}::uuid, '2026-01-01', 5500)`);
      await tx.execute(sql`INSERT INTO payroll.payroll_structures (id, tenant_id, name, is_default, status, created_by, updated_by) VALUES (${st}::uuid, ${t}::uuid, 'PG', true, 'active', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    }, t);
  }
});

afterAll(async () => {
  for (const t of [TENANT, TENANT2]) {
    await asTenant(async (tx) => {
      for (const tbl of ["payroll.payroll_register", "payroll.payroll_slips", "payroll.payroll_run_employee_claims", "payroll.payroll_runs",
        "payroll.employee_pay_group_assignments", "payroll.pay_group_settings", "payroll.pay_groups", "payroll.payroll_ddo_departments",
        "payroll.payroll_ddos", "payroll.payroll_components", "payroll.payroll_structures", "payroll.dearness_allowance_rates"]) {
        await tx.execute(sql.raw(`DELETE FROM ${tbl} WHERE tenant_id = '${t}'`));
      }
    }, t);
  }
  await app.close();
  await sqlClient.end();
});

describe("pay group DDO + bill type", () => {
  it("creates groups carrying an active DDO and a bill type, and lists them with a member count", async () => {
    await createDdo(D1);
    await createDdo(D2);
    GA = await createGroup(`Gazetted ${SUFFIX}`, { ddoCode: D1, billType: "gazetted" });
    GB = await createGroup(`Contract ${SUFFIX}`, { ddoCode: D1, billType: "contract" });
    GC = await createGroup(`Non-gaz ${SUFFIX}`, { ddoCode: D2, billType: "non_gazetted" });
    GD = await createGroup(`Empty ${SUFFIX}`, { ddoCode: D2 });
    GE = await createGroup(`Standalone ${SUFFIX}`);
    const list = body(await app.inject({ method: "GET", url: "/v1/payroll/pay-groups", headers: hdr() })).data as Row[];
    const ga = list.find((g) => g.id === GA)!;
    expect(ga).toMatchObject({ ddo_code: D1, bill_type: "gazetted", employeeCount: 0 });
    expect(list.find((g) => g.id === GD)).toMatchObject({ ddo_code: D2, bill_type: "other" });
    expect(list.find((g) => g.id === GE)).toMatchObject({ ddo_code: null, bill_type: "other" });
  });

  it("refuses an unknown or deactivated DDO and an invalid bill type", async () => {
    const unknown = await post("/v1/payroll/pay-groups", { name: `x ${SUFFIX}`, frequency: "monthly", ddoCode: "NOPE-DDO" });
    expect(unknown.statusCode).toBe(404);
    expect(body(unknown).code).toBe("DDO_NOT_FOUND");
    const bad = await post("/v1/payroll/pay-groups", { name: `y ${SUFFIX}`, frequency: "monthly", billType: "executive" });
    expect(bad.statusCode).toBe(400);
    const spare = `D3-${SUFFIX}`;
    await createDdo(spare);
    expect((await patch(`/v1/payroll/ddos/${spare}/status`, { active: false, reason: "Closed office for this test" })).statusCode).toBe(202);
    await until(() => q(sql`SELECT is_active FROM payroll.payroll_ddos WHERE ddo_code = ${spare}`), (r) => r[0]?.is_active === false);
    const inactive = await post("/v1/payroll/pay-groups", { name: `z ${SUFFIX}`, frequency: "monthly", ddoCode: spare });
    expect(inactive.statusCode).toBe(409);
    expect(body(inactive).code).toBe("DDO_INACTIVE");
  });

  it("PATCH changes the bill type / DDO and audits it", async () => {
    expect((await patch(`/v1/payroll/pay-groups/${GE}`, { billType: "casual" })).statusCode).toBe(202);
    await until(() => q(sql`SELECT bill_type FROM payroll.pay_groups WHERE id = ${GE}::uuid`), (r) => r[0]?.bill_type === "casual");
    const upd = (await auditsFor(GE)).map((r) => r.payload as Row).find((p) => p.action === "update")!;
    expect(upd.newValue).toMatchObject({ bill_type: "casual", ddo_code: null });
  });
});

describe("membership: assign, overlap, move, end, mid-month", () => {
  it("assigns employees from the 1st of a month; the change is audited and listed", async () => {
    for (const [g, e] of [[GA, E1], [GA, E2], [GB, E3]] as const) {
      const res = await assign(g, e, "2026-10-01");
      expect(res.statusCode).toBe(202);
      expect(body(res).data).toMatchObject({ action: "assign" });
    }
    await until(() => assignments(E3.id), (r) => r.length > 0);
    await until(() => assignments(E1.id), (r) => r.length > 0);
    await until(() => assignments(E2.id), (r) => r.length > 0);
    const members = body(await app.inject({ method: "GET", url: `/v1/payroll/pay-groups/${GA}/members`, headers: hdr() }));
    expect(members.total).toBe(2);
    expect(members.data.map((m: Row) => m.employeeNo).sort()).toEqual(noList(E1, E2));
    expect(members.data[0]).toMatchObject({ status: "current", effectiveFrom: "2026-10-01", effectiveTo: null, fullName: expect.any(String) });
    const aud = (await auditsFor(GA)).map((r) => r.payload as Row).filter((p) => p.action === "assign");
    expect(aud).toHaveLength(2);
    expect(aud[0]).toMatchObject({ service: "payroll", resourceType: "payroll_pay_group_member", outcome: "success", effectiveFrom: "2026-10-01" });
    const detail = body(await app.inject({ method: "GET", url: `/v1/payroll/pay-groups/${GA}`, headers: hdr() }));
    expect(detail).toMatchObject({ member_count: 2, active_run_count: 0, ddo_code: D1, bill_type: "gazetted" });
  });

  it("refuses an overlapping assignment: re-assigning, an earlier date, a mid-month date, and unknown employees", async () => {
    const again = await assign(GA, E1, "2026-10-01");
    expect(again.statusCode).toBe(409);
    expect(body(again).code).toBe("ALREADY_MEMBER");
    const before = await assign(GB, E1, "2026-09-01"); // earlier than E1's existing GA assignment
    expect(before.statusCode).toBe(409);
    expect(body(before).code).toBe("MEMBERSHIP_OVERLAP");
    const mid = await assign(GB, E4, "2026-10-15");
    expect(mid.statusCode).toBe(400);
    expect(body(mid).code).toBe("EFFECTIVE_DATE_NOT_MONTH_START");
    const nobody = await assign(GB, { no: "PG-NOBODY" }, "2026-10-01");
    expect(nobody.statusCode).toBe(404);
    expect(body(nobody).code).toBe("EMPLOYEE_NOT_FOUND");
    const short = await post(`/v1/payroll/pay-groups/${GB}/members`, { employeeNo: E4.no, effectiveFrom: "2026-10-01", reason: "short" });
    expect(short.statusCode).toBe(400);
    expect((await assign(GB, E1, "2026-10-01", "x".repeat(20)).then((r) => r.statusCode))).toBe(409);
  });

  it("the DATABASE refuses overlapping periods and a second open-ended membership even if the app is bypassed", async () => {
    await expect(asTenant((tx) => tx.execute(sql`
      INSERT INTO payroll.employee_pay_group_assignments (tenant_id, employee_id, pay_group_id, effective_from, effective_to, created_by)
      VALUES (${TENANT}::uuid, ${E1.id}::uuid, ${GB}::uuid, '2026-11-01', '2026-12-01', ${ACTOR}::uuid)`)))
      .rejects.toThrow(/EMPLOYEE_PAY_GROUP_OVERLAP/);
    await expect(asTenant((tx) => tx.execute(sql`
      INSERT INTO payroll.employee_pay_group_assignments (tenant_id, employee_id, pay_group_id, effective_from, created_by)
      VALUES (${TENANT}::uuid, ${E1.id}::uuid, ${GB}::uuid, '2027-05-01', ${ACTOR}::uuid)`)))
      .rejects.toThrow();
    await expect(asTenant((tx) => tx.execute(sql`
      INSERT INTO payroll.employee_pay_group_assignments (tenant_id, employee_id, pay_group_id, effective_from, effective_to, created_by)
      VALUES (${TENANT}::uuid, ${E5.id}::uuid, ${GB}::uuid, '2026-11-01', '2026-11-01', ${ACTOR}::uuid)`)))
      .rejects.toThrow();
  });

  it("two concurrent assignments of one employee to different groups: exactly one wins (no double membership)", async () => {
    const results = await Promise.all([assign(GB, E5, "2026-10-01"), assign(GC, E5, "2026-10-01")]);
    expect(results.map((r) => r.statusCode)).toEqual([202, 202]); // both pass the read-only pre-check
    await until(() => assignments(E5.id), (r) => r.length > 0);
    await settleMs(600);
    const rows = await assignments(E5.id);
    expect(rows.filter((r) => r.effective_to === null)).toHaveLength(1);
    // the loser's command was a move or a rejection - never two open memberships
    await asTenant((tx) => tx.execute(sql`DELETE FROM payroll.employee_pay_group_assignments WHERE employee_id = ${E5.id}::uuid`));
  });

  it("a mid-month start is allowed once the tenant setting is switched on (audited), then switched back", async () => {
    expect(body(await app.inject({ method: "GET", url: "/v1/payroll/pay-group-settings", headers: hdr() }))).toEqual({ allowMidMonthEffective: false });
    expect((await app.inject({ method: "PUT", url: "/v1/payroll/pay-group-settings", headers: hdr(), payload: { allowMidMonthEffective: true, reason: "Joiners are paid from the joining date" } })).statusCode).toBe(202);
    await until(() => q(sql`SELECT allow_mid_month_effective FROM payroll.pay_group_settings`), (r) => r[0]?.allow_mid_month_effective === true);
    expect((await assign(GB, E4, "2026-10-15")).statusCode).toBe(202);
    await until(() => assignments(E4.id), (r) => r.length > 0);
    expect((await app.inject({ method: "PUT", url: "/v1/payroll/pay-group-settings", headers: hdr(), payload: { allowMidMonthEffective: false, reason: "Back to month-start changes" } })).statusCode).toBe(202);
    await until(() => q(sql`SELECT allow_mid_month_effective FROM payroll.pay_group_settings`), (r) => r[0]?.allow_mid_month_effective === false);
    const aud = (await auditsFor(TENANT)).map((r) => r.payload as Row).filter((p) => p.resourceType === "payroll_pay_group_settings");
    expect(aud.length).toBe(2);
  });

  it("payroll roles may change membership; an employee or an hr_admin may not (hr_admin may read)", async () => {
    const denied = await post(`/v1/payroll/pay-groups/${GB}/members`, { employeeNo: E6.no, effectiveFrom: "2026-10-01", reason: "Establishment order 12/2026" }, ["employee"]);
    expect(denied.statusCode).toBe(403);
    const hr = await app.inject({ method: "GET", url: `/v1/payroll/pay-groups/${GA}/members`, headers: hdr(["hr_admin"]) });
    expect(hr.statusCode).toBe(200);
    const hrWrite = await post(`/v1/payroll/pay-groups/${GB}/members`, { employeeNo: E6.no, effectiveFrom: "2026-10-01", reason: "Establishment order 12/2026" }, ["hr_admin"]);
    expect(hrWrite.statusCode).toBe(403);
  });

  it("moves E1 from GA to GB effective 2026-12-01: history kept, the old group pays through November", async () => {
    const res = await assign(GB, E1, "2026-12-01", "Re-designated to a contractual post");
    expect(res.statusCode).toBe(202);
    expect(body(res).data).toMatchObject({ action: "move" });
    await until(() => assignments(E1.id), (r) => r.length === 2);
    const rows = await assignments(E1.id);
    expect(rows).toEqual([
      { pay_group_id: GA, effective_from: "2026-10-01", effective_to: "2026-12-01" },
      { pay_group_id: GB, effective_from: "2026-12-01", effective_to: null },
    ]);
    const m = (month: string) => asTenant((tx) => resolveMonthMembers(tx, TENANT, month));
    expect((await m("2026-11")).get(E1.id)).toBe(GA);
    expect((await m("2026-12")).get(E1.id)).toBe(GB);
    expect((await m("2027-03")).get(E1.id)).toBe(GB);
    const mv = (await auditsFor(GB)).map((r) => r.payload as Row).find((p) => p.action === "move")!;
    expect(mv).toMatchObject({ fromPayGroupId: GA, employeeId: E1.id, outcome: "success" });
    // GA's membership list: E1 is now scheduled to leave (still current today), history shows both
    const hist = body(await app.inject({ method: "GET", url: `/v1/payroll/pay-groups/${GA}/members?history=true`, headers: hdr() }));
    expect(hist.data.find((x: Row) => x.employeeNo === E1.no)).toMatchObject({ effectiveTo: "2026-12-01" });
  });

  it("the employee's profile read returns the current group and the history", async () => {
    const r = body(await app.inject({ method: "GET", url: `/v1/payroll/employees/${E1.id}/pay-group`, headers: hdr() }));
    expect(r.history).toHaveLength(2);
    expect(r.history[0]).toMatchObject({ payGroupId: GB, billType: "contract", ddoCode: D1 });
    const none = body(await app.inject({ method: "GET", url: `/v1/payroll/employees/${E6.id}/pay-group`, headers: hdr() }));
    expect(none).toEqual({ current: null, history: [] });
  });

  it("ends a membership on a month start; ending something that is not open is refused", async () => {
    const res = await post(`/v1/payroll/pay-groups/${GB}/members/${E4.id}/end`, { endsOn: "2027-06-01", reason: "Contract completed" });
    expect(res.statusCode).toBe(202);
    await until(() => assignments(E4.id), (r) => r[0]?.effective_to === "2027-06-01");
    expect((await post(`/v1/payroll/pay-groups/${GB}/members/${E4.id}/end`, { endsOn: "2027-07-01", reason: "Contract completed" })).statusCode).toBe(409);
    expect((await post(`/v1/payroll/pay-groups/${GA}/members/${E3.id}/end`, { endsOn: "2027-07-01", reason: "Contract completed" })).statusCode).toBe(409);
    // reopen: E4 stays a member of GB beyond (a later move/assign is possible), keep as member until Jun 2027
  });
});

describe("bulk assign + unassigned report", () => {
  let batchId = "";
  it("validates every row and writes ONE audit event for the batch", async () => {
    const res = await post(`/v1/payroll/pay-groups/${GC}/members/bulk`, {
      effectiveFrom: "2026-10-01", reason: "Bulk onboarding of the DDO D2 establishment",
      rows: [{ employeeNo: E5.no }, { employeeNo: "PG-NOBODY" }, { employeeNo: E5.no }, { employeeNo: E7.no }, { employeeNo: E6.no, employeeId: E6.id }],
    });
    expect(res.statusCode).toBe(202);
    const data = body(res).data;
    batchId = data.batchId;
    expect(data.accepted).toBe(2);
    expect(data.rejected.map((r: Row) => [r.row, r.code])).toEqual([[1, "EMPLOYEE_NOT_FOUND"], [2, "DUPLICATE_ROW"], [4, "ROW_INVALID"]]);
    await until(() => assignments(E7.id), (r) => r.length > 0);
    await until(() => assignments(E5.id), (r) => r.length > 0);
    const aud = (await auditsFor(GC)).map((r) => r.payload as Row);
    const bulk = aud.filter((p) => p.action === "bulk_assign");
    expect(bulk).toHaveLength(1);
    expect(bulk[0]).toMatchObject({ batchId, requested: 2, assigned: expect.arrayContaining([E5.id, E7.id]) });
    expect(aud.filter((p) => p.action === "assign" && p.batchId === batchId)).toHaveLength(0);
  });

  it("re-submitting the same batch rows reports already-members; an all-rejected batch is a 422 with the per-row report", async () => {
    const res = await post(`/v1/payroll/pay-groups/${GC}/members/bulk`, {
      effectiveFrom: "2026-10-01", reason: "Bulk onboarding of the DDO D2 establishment", rows: [{ employeeNo: E5.no }, { employeeNo: "PG-NOBODY" }],
    });
    expect(res.statusCode).toBe(422);
    expect(body(res).code).toBe("BULK_NOTHING_TO_ASSIGN");
    expect(body(res).details.rejected.map((r: Row) => r.code)).toEqual(["ALREADY_MEMBER", "EMPLOYEE_NOT_FOUND"]);
  });

  it("lists employees in no pay group for a month (and fails closed when HRMS is down)", async () => {
    const r = body(await app.inject({ method: "GET", url: "/v1/payroll/pay-groups/unassigned?month=2026-11", headers: hdr() }));
    expect(r).toMatchObject({ month: "2026-11", total: 1 });
    expect(r.data).toEqual([{ employeeId: E6.id, employeeNo: E6.no, fullName: E6.no, departmentName: "Treasury", reason: "no_group" }]);
    // E4's contract ended 2027-06-01, so in 2027-07 both E4 and E6 are unassigned
    const later = body(await app.inject({ method: "GET", url: "/v1/payroll/pay-groups/unassigned?month=2027-07", headers: hdr() }));
    expect(later.data.map((d: Row) => d.employeeNo).sort()).toEqual(noList(E4, E6));
    const { HrmsUnavailableError } = await import("../src/shared/hrms-client.js");
    vi.mocked(fetchPayrollInput).mockRejectedValueOnce(new HrmsUnavailableError("down"));
    const down = await app.inject({ method: "GET", url: "/v1/payroll/pay-groups/unassigned?month=2026-11", headers: hdr() });
    expect(down.statusCode).toBe(502);
  });
});

describe("pay-group payroll runs", () => {
  const month = (m: string) => vi.mocked(fetchPayrollInput).mockResolvedValue({ month: m, employees: FEED, lopDays: {}, overtimeHours: {} } as unknown as Awaited<ReturnType<typeof fetchPayrollInput>>);

  it("one run per group; each includes exactly its members for the month (Nov 2026)", async () => {
    month("2026-11");
    const res = await post("/v1/payroll/runs", { runNo: `R-NOV-${SUFFIX}`, month: "2026-11", structureId: STRUCTURE, payGroupIds: [GA, GB] });
    expect(res.statusCode).toBe(202);
    const runIds = body(res).data.runIds as string[];
    expect(runIds).toHaveLength(2);
    for (const id of runIds) await runSettled(id);
    const runs = await q(sql`SELECT id::text, pay_group_id::text, ddo_code, status, run_no FROM payroll.payroll_runs WHERE id IN (${sql.join(runIds.map((i) => sql`${i}::uuid`), sql`, `)})`);
    const runOf = (g: string) => runs.find((r) => r.pay_group_id === g)!;
    expect(runOf(GA)).toMatchObject({ ddo_code: D1 });
    expect(runOf(GA).run_no).not.toBe(runOf(GB).run_no);
    // E1 is still in GA in November; E3 and E4 (from 2026-10-15) are GB
    expect(await slipNos(runOf(GA).id as string)).toEqual(noList(E1, E2));
    expect(await slipNos(runOf(GB).id as string)).toEqual(noList(E3, E4));
    // E5/E6/E7 are in no pay group GA/GB: in no slip of these runs
  }, 90_000);

  it("a mid-year move takes effect from its effective month (Dec 2026: E1 is paid by GB, not GA)", async () => {
    month("2026-12");
    const res = await post("/v1/payroll/runs", { runNo: `R-DEC-${SUFFIX}`, month: "2026-12", structureId: STRUCTURE, payGroupIds: [GA, GB] });
    expect(res.statusCode).toBe(202);
    const runIds = body(res).data.runIds as string[];
    decRunIds = runIds;
    for (const id of runIds) await runSettled(id);
    const runs = await q(sql`SELECT id::text, pay_group_id::text FROM payroll.payroll_runs WHERE id IN (${sql.join(runIds.map((i) => sql`${i}::uuid`), sql`, `)})`);
    expect(await slipNos(runs.find((r) => r.pay_group_id === GA)!.id as string)).toEqual(noList(E2));
    expect(await slipNos(runs.find((r) => r.pay_group_id === GB)!.id as string)).toEqual(noList(E1, E3, E4));
  }, 90_000);

  it("'all active groups of DDO' creates a run per group with members and reports the empty ones", async () => {
    month("2026-10");
    const res = await post("/v1/payroll/runs", { runNo: `R-OCT-${SUFFIX}`, month: "2026-10", structureId: STRUCTURE, ddoCode: D2, allPayGroupsOfDdo: true });
    expect(res.statusCode).toBe(202);
    const data = body(res).data;
    expect(data.runIds).toHaveLength(1);
    expect(data.skippedEmptyGroups).toEqual([GD]);
    await runSettled(data.runIds[0]);
    expect(await slipNos(data.runIds[0])).toEqual(noList(E5, E7));
    const [run] = await q(sql`SELECT ddo_code, pay_group_id::text FROM payroll.payroll_runs WHERE id = ${data.runIds[0]}::uuid`);
    expect(run).toMatchObject({ ddo_code: D2, pay_group_id: GC });
  }, 90_000);

  it("refuses an empty group, an inactive group, an unknown group, a DDO with no active groups", async () => {
    const empty = await post("/v1/payroll/runs", { runNo: `R-EMPTY-${SUFFIX}`, month: "2026-11", structureId: STRUCTURE, payGroupId: GD });
    expect(empty.statusCode).toBe(422);
    expect(body(empty).code).toBe("PAY_GROUP_EMPTY");
    const unknown = await post("/v1/payroll/runs", { runNo: `R-X-${SUFFIX}`, month: "2026-11", structureId: STRUCTURE, payGroupId: randomUUID() });
    expect(unknown.statusCode).toBe(404);
    const noDdo = await post("/v1/payroll/runs", { runNo: `R-Y-${SUFFIX}`, month: "2026-11", structureId: STRUCTURE, ddoCode: "NOPE", allPayGroupsOfDdo: true });
    expect(noDdo.statusCode).toBe(404);
    expect((await post("/v1/payroll/runs", { runNo: "R-Z", month: "2026-11", structureId: STRUCTURE, allPayGroupsOfDdo: true })).statusCode).toBe(400);
    expect((await post("/v1/payroll/runs", { runNo: "R-W", month: "2026-11", structureId: STRUCTURE, payGroupId: GA, runType: "supplementary" })).statusCode).toBe(400);
  });

  it("the same group twice for one period is a 409 (one non-failed regular run per group and month)", async () => {
    const dup = await post("/v1/payroll/runs", { runNo: `R-NOV2-${SUFFIX}`, month: "2026-11", structureId: STRUCTURE, payGroupId: GA });
    expect(dup.statusCode).toBe(409);
    // a double inclusion is caught first (E1/E2 already hold November claims)
    expect(["DUPLICATE_RUN_FOR_PERIOD", "EMPLOYEE_ALREADY_IN_RUN"]).toContain(body(dup).code);
  });

  it("a whole-tenant run for a period that pay-group runs already cover is refused up front (409), and creates nothing", async () => {
    month("2026-11");
    const before = await q(sql`SELECT COUNT(*)::int AS n FROM payroll.payroll_runs WHERE month = '2026-11'`);
    const res = await post("/v1/payroll/runs", { runNo: `R-LEG-NOV-${SUFFIX}`, month: "2026-11", structureId: STRUCTURE });
    expect(res.statusCode).toBe(409);
    expect(body(res).code).toBe("EMPLOYEE_ALREADY_IN_RUN");
    expect(await q(sql`SELECT COUNT(*)::int AS n FROM payroll.payroll_runs WHERE month = '2026-11'`)).toEqual(before);
  }, 60_000);

  it("the async guard still stops a department-scoped legacy run that overlaps the group runs: it FAILS, nobody is paid twice", async () => {
    month("2026-11");
    const res = await post("/v1/payroll/runs", { runNo: `R-LEG-DEPT-${SUFFIX}`, month: "2026-11", structureId: STRUCTURE, departmentId: DEPT });
    expect(res.statusCode).toBe(202);
    const run = await runSettled(body(res).id);
    expect(run.status).toBe("failed");
    expect(run.last_error).toContain("EMPLOYEE_ALREADY_IN_RUN");
    expect(await slipNos(body(res).id)).toEqual([]);
    // the group runs' claims are intact: 4 employees for Nov (E1,E2,E3,E4), the failed run released its own
    const claims = await q(sql`SELECT employee_id::text FROM payroll.payroll_run_employee_claims WHERE month = '2026-11'`);
    expect(claims.map((c) => c.employee_id).sort()).toEqual([E1.id, E2.id, E3.id, E4.id].sort());
  }, 90_000);

  it("supplementary and arrears runs for the same employees and month are NOT blocked by the regular run", async () => {
    month("2026-11");
    const waitRun = async (id: string) => {
      for (let i = 0; i < 160; i++) {
        await settleMs(250);
        const [r] = await q(sql`SELECT status FROM payroll.payroll_runs WHERE id = ${id}::uuid`);
        const n = await q(sql`SELECT 1 FROM payroll.payroll_slips WHERE run_id = ${id}::uuid LIMIT 1`);
        if (r?.status === "failed" || n.length > 0) return r!.status as string;
      }
      throw new Error("off-cycle run did not settle");
    };
    for (const runType of ["supplementary", "arrears"] as const) {
      const res = await post("/v1/payroll/runs", { runNo: `R-${runType}-${SUFFIX}`, month: "2026-11", structureId: STRUCTURE, runType });
      expect(res.statusCode).toBe(202);
      expect(await waitRun(body(res).id)).not.toBe("failed");
      expect((await slipNos(body(res).id)).length).toBeGreaterThan(0);
    }
    // and they take no claims: the regular runs' four claims are untouched
    const claims = await q(sql`SELECT 1 FROM payroll.payroll_run_employee_claims WHERE month = '2026-11'`);
    expect(claims).toHaveLength(4);
  }, 120_000);

  it("a redelivered / resumed regular run keeps its own claims and completes: duplicate delivery changes nothing, re-claiming is idempotent", async () => {
    const [runId] = decRunIds as [string, ...string[]];
    const claimsOf = () => q(sql`SELECT employee_id::text, run_id::text FROM payroll.payroll_run_employee_claims WHERE run_id = ${runId}::uuid ORDER BY employee_id`);
    const before = await claimsOf();
    const slipsBefore = await slipNos(runId);
    expect(before.length).toBeGreaterThan(0);
    const [run] = await q(sql`SELECT run_no, month, structure_id::text, pay_group_id::text, ddo_code FROM payroll.payroll_runs WHERE id = ${runId}::uuid`);
    // the same run delivered again under a NEW message id (a redelivery that slipped past markProcessed)
    await queue.publish(COMMANDS.runCreate, {
      messageId: randomUUID(), type: COMMANDS.runCreate, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: runId, tenantId: TENANT, runNo: run!.run_no, month: run!.month, structureId: run!.structure_id, runType: "regular", payGroupId: run!.pay_group_id, ddoCode: run!.ddo_code ?? undefined, status: "draft" },
    });
    await settleMs(1500);
    expect(await claimsOf()).toEqual(before);
    expect(await slipNos(runId)).toEqual(slipsBefore);
    expect((await q(sql`SELECT status FROM payroll.payroll_runs WHERE id = ${runId}::uuid`))[0]?.status).not.toBe("failed");
    // a resumed pass re-claims the same employees: no conflict with its own claims
    const ids = before.map((c) => c.employee_id as string);
    const doubled = await asTenant(async (tx) => {
      await claimRunEmployees(tx, { tenantId: TENANT, runId, month: run!.month as string, employeeIds: ids });
      return findDoubleRunEmployees(tx, TENANT, run!.month as string, ids, runId);
    });
    expect(doubled).toEqual([]);
    expect(await claimsOf()).toEqual(before);
  }, 60_000);

  it("a legacy run first, then a pay-group run for the same period: refused with 409 EMPLOYEE_ALREADY_IN_RUN", async () => {
    month("2027-01");
    const legacy = await post("/v1/payroll/runs", { runNo: `R-LEG-JAN-${SUFFIX}`, month: "2027-01", structureId: STRUCTURE });
    expect(legacy.statusCode).toBe(202);
    expect((await runSettled(body(legacy).id)).status).not.toBe("failed");
    expect(await slipNos(body(legacy).id)).toEqual(noList(E1, E2, E3, E4, E5, E6, E7));
    const group = await post("/v1/payroll/runs", { runNo: `R-GRP-JAN-${SUFFIX}`, month: "2027-01", structureId: STRUCTURE, payGroupId: GA });
    expect(group.statusCode).toBe(409);
    expect(body(group).code).toBe("EMPLOYEE_ALREADY_IN_RUN");
  }, 90_000);

  it("concurrent legacy + pay-group runs for one period: no employee is ever in two non-failed regular runs", async () => {
    month("2027-02");
    const [legacy, group] = await Promise.all([
      post("/v1/payroll/runs", { runNo: `R-RACE-L-${SUFFIX}`, month: "2027-02", structureId: STRUCTURE }),
      post("/v1/payroll/runs", { runNo: `R-RACE-G-${SUFFIX}`, month: "2027-02", structureId: STRUCTURE, payGroupId: GA }),
    ]);
    const ids: string[] = [];
    if (legacy.statusCode === 202) ids.push(body(legacy).id);
    if (group.statusCode === 202) ids.push(...body(group).data.runIds);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) await runSettled(id);
    await settleMs(500);
    const dupes = await q(sql`
      SELECT s.employee_id::text, COUNT(*)::int AS n FROM payroll.payroll_slips s
        JOIN payroll.payroll_runs r ON r.id = s.run_id
       WHERE r.month = '2027-02' AND r.run_type = 'regular' AND r.status NOT IN ('failed', 'cancelled')
       GROUP BY s.employee_id HAVING COUNT(*) > 1`);
    expect(dupes).toEqual([]);
    const ok = await q(sql`SELECT 1 FROM payroll.payroll_runs WHERE month = '2027-02' AND status NOT IN ('failed','cancelled') AND run_type = 'regular'`);
    expect(ok.length).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it("the claims table is the race-safe backstop: two transactions claiming the same employee for one month - exactly one commits", async () => {
    const R1 = randomUUID();
    const R2 = randomUUID();
    await asTenant(async (tx) => {
      for (const [id, no, ddo] of [[R1, "RACE-1", "RACE-A"], [R2, "RACE-2", "RACE-B"]] as const) {
        await tx.execute(sql`INSERT INTO payroll.payroll_runs (id, tenant_id, run_no, month, structure_id, run_type, ddo_code, status, created_by, updated_by)
          VALUES (${id}::uuid, ${TENANT}::uuid, ${no + SUFFIX}, '2027-03', ${STRUCTURE}::uuid, 'regular', ${ddo}, 'processing', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
      }
    });
    const claimer = (runId: string, ids: string[]) => asTenant(async (tx) => {
      await claimRunEmployees(tx, { tenantId: TENANT, runId, month: "2027-03", employeeIds: ids });
      await new Promise((r) => setTimeout(r, 150)); // hold the claim so the other tx must wait for it
      const doubled = await findDoubleRunEmployees(tx, TENANT, "2027-03", ids, runId);
      if (doubled.length > 0) throw new Error(`EMPLOYEE_ALREADY_IN_RUN ${doubled.length}`);
      return "claimed";
    });
    // overlapping sets, deliberately in opposite order: sorted claims must not deadlock
    const settled = await Promise.allSettled([claimer(R1, [E1.id, E2.id, E3.id]), claimer(R2, [E3.id, E2.id, E4.id])]);
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    const rejected = settled.find((s) => s.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason)).toContain("EMPLOYEE_ALREADY_IN_RUN");
    const claims = await q(sql`SELECT employee_id::text, run_id::text FROM payroll.payroll_run_employee_claims WHERE month = '2027-03'`);
    expect(new Set(claims.map((c) => c.run_id)).size).toBe(1);
    // a failed run releases its claims (trigger); the other run's employees can then be claimed again
    const winner = claims[0]!.run_id as string;
    await asTenant((tx) => tx.execute(sql`UPDATE payroll.payroll_runs SET status = 'failed' WHERE id = ${winner}::uuid`));
    expect(await q(sql`SELECT 1 FROM payroll.payroll_run_employee_claims WHERE month = '2027-03'`)).toHaveLength(0);
  }, 60_000);
});

describe("deactivation guard", () => {
  it("is refused (409) while the group has current members; the consumer re-checks authoritatively", async () => {
    const res = await patch(`/v1/payroll/pay-groups/${GA}/status`, { active: false, reason: "Bill merged into the new one" });
    expect(res.statusCode).toBe(409);
    expect(body(res).code).toBe("PAY_GROUP_HAS_MEMBERS");
    // bypass the route's pre-check: publish the command directly - the consumer must refuse
    await fin03Commands.setPayGroupActive({ tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), roles: ["payroll_admin"] } as unknown as RequestContext, GA, false, "Bypassing the route pre-check");
    await settleMs(800);
    expect((await q(sql`SELECT status FROM payroll.pay_groups WHERE id = ${GA}::uuid`))[0]?.status).toBe("active");
    const rejected = (await auditsFor(GA)).map((r) => r.payload as Row).find((p) => p.action === "deactivate");
    expect(rejected).toMatchObject({ outcome: "rejected", blockedBy: "PAY_GROUP_HAS_MEMBERS" });
  });

  it("is refused while a draft or processing run exists for the group", async () => {
    const run = randomUUID();
    await asTenant((tx) => tx.execute(sql`INSERT INTO payroll.payroll_runs (id, tenant_id, run_no, month, structure_id, run_type, pay_group_id, status, created_by, updated_by)
      VALUES (${run}::uuid, ${TENANT}::uuid, ${"DRAFT-" + SUFFIX}, '2028-01', ${STRUCTURE}::uuid, 'regular', ${GE}::uuid, 'draft', ${ACTOR}::uuid, ${ACTOR}::uuid)`));
    const res = await patch(`/v1/payroll/pay-groups/${GE}/status`, { active: false, reason: "Standalone group retired" });
    expect(res.statusCode).toBe(409);
    expect(body(res).code).toBe("PAY_GROUP_HAS_ACTIVE_RUN");
    await asTenant((tx) => tx.execute(sql`UPDATE payroll.payroll_runs SET status = 'failed' WHERE id = ${run}::uuid`));
  });

  it("succeeds once members are gone and no run is in flight; a deactivated group takes no members", async () => {
    const ok = await patch(`/v1/payroll/pay-groups/${GE}/status`, { active: false, reason: "Standalone group retired" });
    expect(ok.statusCode).toBe(202);
    await until(() => q(sql`SELECT status FROM payroll.pay_groups WHERE id = ${GE}::uuid`), (r) => r[0]?.status === "archived");
    const refused = await assign(GE, E6, "2026-10-01");
    expect(refused.statusCode).toBe(409);
    expect(body(refused).code).toBe("PAY_GROUP_INACTIVE");
  });
});

describe("employee lookup beyond hrms's 2000-row feed cap", () => {
  let GG = "";
  it("assign-by-number and bulk assign resolve employees that are not in the capped feed (no false EMPLOYEE_NOT_FOUND)", async () => {
    expect([...(await fetchEmployeeSummaries(TENANT))].some(([id]) => id === BIG.id)).toBe(false); // really beyond the cap
    GG = await createGroup(`Big tenant ${SUFFIX}`);
    const one = await assign(GG, BIG, "2026-10-01");
    expect(one.statusCode).toBe(202);
    await until(() => assignments(BIG.id), (r) => r.length > 0);
    const res = await post(`/v1/payroll/pay-groups/${GG}/members/bulk`, {
      effectiveFrom: "2026-10-01", reason: "Bulk onboarding of a very large tenant",
      rows: [{ employeeNo: BIG2.no }, { employeeNo: BIG.no }, { employeeNo: "NOPE-" + SUFFIX }, { employeeId: BIG2.id }],
    });
    expect(res.statusCode).toBe(202);
    expect(body(res).data.accepted).toBe(1);
    expect(body(res).data.rejected.map((r: Row) => [r.row, r.code])).toEqual([[1, "ALREADY_MEMBER"], [2, "EMPLOYEE_NOT_FOUND"], [3, "DUPLICATE_ROW"]]);
    await until(() => assignments(BIG2.id), (r) => r.length > 0);
    const members = body(await app.inject({ method: "GET", url: `/v1/payroll/pay-groups/${GG}/members`, headers: hdr() }));
    expect(members.data.map((m: Row) => m.employeeNo).sort()).toEqual([BIG.no, BIG2.no].sort());
  }, 60_000);

  it("an hrms outage is a 502, never a false EMPLOYEE_NOT_FOUND", async () => {
    const { HrmsUnavailableError } = await import("../src/shared/hrms-client.js");
    vi.mocked(searchEmployeeSummariesStrict).mockRejectedValueOnce(new HrmsUnavailableError("down"));
    const res = await assign(GG, E6, "2026-10-01");
    expect(res.statusCode).toBe(502);
    expect(body(res).code).toBe("HRMS_UNAVAILABLE");
  });
});

describe("unassigned report and inactive groups", () => {
  it("lists an employee whose only membership is in a deactivated group (no run can pay them)", async () => {
    const GF = await createGroup(`Soon retired ${SUFFIX}`);
    expect((await assign(GF, E6, "2026-10-01")).statusCode).toBe(202);
    await until(() => assignments(E6.id), (r) => r.length > 0);
    const before = body(await app.inject({ method: "GET", url: "/v1/payroll/pay-groups/unassigned?month=2026-11", headers: hdr() }));
    expect(before.data.map((d: Row) => d.employeeNo)).not.toContain(E6.no);
    await asTenant((tx) => tx.execute(sql`UPDATE payroll.pay_groups SET status = 'archived' WHERE id = ${GF}::uuid`));
    const after = body(await app.inject({ method: "GET", url: "/v1/payroll/pay-groups/unassigned?month=2026-11", headers: hdr() }));
    expect(after.data.find((d: Row) => d.employeeNo === E6.no)).toMatchObject({ reason: "inactive_group" });
  });
});

describe("pay-group run creation vs deactivation", () => {
  it("a group deactivated before its run row is written is refused (409), not run", async () => {
    const GH = await createGroup(`Racy ${SUFFIX}`);
    expect((await assign(GH, E7, "2028-02-01")).statusCode).toBe(202);
    await until(() => assignments(E7.id), (r) => r.some((x) => x.pay_group_id === GH));
    await asTenant((tx) => tx.execute(sql`UPDATE payroll.pay_groups SET status = 'archived' WHERE id = ${GH}::uuid`));
    const res = await post("/v1/payroll/runs", { runNo: `R-RACY-${SUFFIX}`, month: "2028-02", structureId: STRUCTURE, payGroupId: GH });
    expect(res.statusCode).toBe(409);
    expect(body(res).code).toBe("PAY_GROUP_INACTIVE");
  });
});

describe("tenant isolation", () => {
  it("another tenant sees neither the group, its members nor its assignments", async () => {
    const other = { authorization: hdr(["payroll_admin"], TENANT2).authorization };
    expect((await app.inject({ method: "GET", url: `/v1/payroll/pay-groups/${GA}`, headers: other })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/v1/payroll/pay-groups/${GA}/members`, headers: other })).statusCode).toBe(404);
    expect((await post(`/v1/payroll/pay-groups/${GA}/members`, { employeeNo: E6.no, effectiveFrom: "2026-10-01", reason: "Cross-tenant attempt for this test" }, ["payroll_admin"], TENANT2)).statusCode).toBe(404);
    expect(await q(sql`SELECT 1 FROM payroll.employee_pay_group_assignments`, TENANT2)).toHaveLength(0);
    expect((await q(sql`SELECT 1 FROM payroll.employee_pay_group_assignments`)).length).toBeGreaterThan(0);
  });
});

describe("a tenant with no pay groups behaves exactly as before", () => {
  it("a run without a pay group pays every eligible employee, carries no pay group, and the duplicate guard is unchanged", async () => {
    vi.mocked(fetchPayrollInput).mockResolvedValue({ month: "2026-11", employees: FEED, lopDays: {}, overtimeHours: {} } as unknown as Awaited<ReturnType<typeof fetchPayrollInput>>);
    const res = await post("/v1/payroll/runs", { runNo: `LEG-${SUFFIX}`, month: "2026-11", structureId: STRUCTURE2 }, ["payroll_admin"], TENANT2);
    expect(res.statusCode).toBe(202);
    expect(body(res).data?.runIds).toBeUndefined();
    const id = body(res).id as string;
    const run = await (async () => {
      for (let i = 0; i < 160; i++) {
        await settleMs(250);
        const [r] = await q(sql`SELECT status, last_error FROM payroll.payroll_runs WHERE id = ${id}::uuid`, TENANT2);
        const regs = await q(sql`SELECT 1 FROM payroll.payroll_register WHERE run_id = ${id}::uuid LIMIT 1`, TENANT2);
        if (r?.status === "failed" || regs.length > 0) return r!;
      }
      throw new Error("legacy run did not settle");
    })();
    expect(run.status).not.toBe("failed");
    expect(await slipNos(id, TENANT2)).toEqual(noList(E1, E2, E3, E4, E5, E6, E7));
    const [row] = await q(sql`SELECT pay_group_id, ddo_code FROM payroll.payroll_runs WHERE id = ${id}::uuid`, TENANT2);
    expect(row).toEqual({ pay_group_id: null, ddo_code: null });
    const dup = await post("/v1/payroll/runs", { runNo: `LEG2-${SUFFIX}`, month: "2026-11", structureId: STRUCTURE2 }, ["payroll_admin"], TENANT2);
    expect(dup.statusCode).toBe(409);
    expect(body(dup).code).toBe("DUPLICATE_RUN_FOR_PERIOD");
  }, 120_000);
});
