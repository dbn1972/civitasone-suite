/**
 * PAY-PROFILES (PR2) end to end against a real database and the real run
 * consumer: one salary run with mixed pay profiles (no per-run structure
 * lock-in), the persisted profile / snapshot / EPF wage, fail-closed runs, and
 * the allowance-rules config API (roles, locked periods, CQRS + audit).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return { ...actual, fetchPayrollInput: vi.fn(), fetchEmployeeSummaries: vi.fn(async () => new Map()) };
});
import { fetchPayrollInput } from "../src/shared/hrms-client.js";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerPayrollConsumers, generateRetroArrears } from "../src/modules/payroll/consumer.js";
import { deputationAllowanceMinor } from "../src/modules/payroll/domain.js";
import { registerPayProfileConsumers } from "../src/modules/pay-profiles/consumer.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const STRUCTURE = randomUUID();
const DEPT = randomUUID();
const MONTH = "2026-11"; // 30 days
const ids = { g: randomUUID(), a: randomUUID(), b: randomUUID(), c: randomUUID(), k: randomUUID() };
const DEP_ID = randomUUID();

const tok = (roles: string[]) => signToken({ sub: ACTOR, tid: TENANT, roles, sid: "pp" }, SECRET, 3600);
const hdr = (roles = ["payroll_admin"]) => ({ authorization: `Bearer ${tok(roles)}`, "content-type": "application/json" });
const asTenant = <T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction(fn));
const q = async (s: ReturnType<typeof sql>) => (await asTenant((tx) => tx.execute(s))) as unknown as Array<Record<string, unknown>>;

const deputation = (o: Record<string, unknown>) => ({
  id: DEP_ID, status: "active", direction: "in", option: "parent_scale", stationType: "other", parentCadre: "CSS",
  parentOrganisation: "Ministry X", parentPayLevel: 7, parentBasicMinor: "4490000", postPayLevel: null, postBasicMinor: null,
  allowanceMode: "auto", fixedAllowanceMinor: "0", foreignService: false, parentPensionScheme: "GPF", daSource: "central",
  parentDaRateBps: null, tenureFrom: "2026-10-15", tenureTo: "2029-10-14", ...o,
});
const profile = (p: string, extra: Record<string, unknown> = {}) => ({
  profile: p, source: "assigned", profileId: randomUUID(), effectiveFrom: "2026-11-01", changedWithinMonth: false, ...extra,
});
const employee = (id: string, no: string, basic: string, city: string, scheme: string, payProfile?: Record<string, unknown>) => ({
  id, employeeNo: no, fullName: no, basicMinor: basic, dateOfJoining: "2020-01-01", payStructureId: null,
  bankAccountNo: null, bankIfsc: null, pan: null, uan: null, pran: null, cityClass: city, taxRegime: "new",
  departmentId: DEPT, pensionScheme: scheme, paymentRoute: "payroll", eligibleForPayroll: true,
  statutoryPf: true, statutoryEsi: true, statutoryNps: true,
  ...(payProfile ? { payProfile } : {}),
});

const MIXED = [
  employee(ids.g, "PP-G", "1500000", "X", "NPS"),
  employee(ids.a, "PP-A", "9999900", "Y", "NPS", profile("deputation_parent_scale", { deputation: deputation({}) })),
  employee(ids.b, "PP-B", "9999900", "Z", "NPS", profile("deputation_post_scale", { deputation: deputation({ option: "post_scale", postBasicMinor: "4760000", parentPensionScheme: null }) })),
  employee(ids.c, "PP-C", "9999900", "X", "NPS", profile("consolidated_contract", { consolidatedMonthlyMinor: "3000000" })),
];

let app: FastifyInstance;

async function startRun(runNo: string, month = MONTH): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/v1/payroll/runs", headers: hdr(), payload: { runNo, month, structureId: STRUCTURE } });
  expect([201, 202]).toContain(res.statusCode);
  return res.json().data?.id ?? res.json().id;
}

async function settle(runId: string): Promise<{ status: string; last_error: string | null }> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    await new Promise((r) => setTimeout(r, 250));
    const [run] = await q(sql`SELECT status, last_error FROM payroll.payroll_runs WHERE id = ${runId}::uuid`);
    const regs = await q(sql`SELECT 1 FROM payroll.payroll_register WHERE run_id = ${runId}::uuid LIMIT 1`);
    if (run?.status === "failed" || regs.length > 0) return run as { status: string; last_error: string | null };
    if (Date.now() > deadline) throw new Error("run did not settle");
  }
}

beforeAll(async () => {
  const rawSubscribe = queue.subscribe.bind(queue);
  (queue as unknown as { subscribe: typeof queue.subscribe }).subscribe = ((topic: string, handler: (msg: { tenantId: string }) => Promise<void>) =>
    rawSubscribe(topic, (msg: { tenantId: string }) => runWithTenant(msg.tenantId, () => handler(msg)))) as unknown as typeof queue.subscribe;
  registerPayrollConsumers(queue);
  registerPayProfileConsumers(queue);
  await queue.start();
  app = await buildApp();
  await asTenant(async (tx) => {
    await tx.execute(sql`INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps) VALUES (${TENANT}::uuid, '2026-01-01', 5500)`);
    await tx.execute(sql`INSERT INTO payroll.payroll_structures (id, tenant_id, name, is_default, status, created_by, updated_by) VALUES (${STRUCTURE}::uuid, ${TENANT}::uuid, 'PP', true, 'active', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    await tx.execute(sql`INSERT INTO payroll.payroll_components (tenant_id, structure_id, code, name, component_type, fixed_minor, created_by, updated_by) VALUES (${TENANT}::uuid, ${STRUCTURE}::uuid, 'TA', 'Transport Allowance', 'earning', 360000, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    // The tenant's own rules (independent of the platform go-live date the migration seeds).
    await tx.execute(sql`
      INSERT INTO statutory.allowance_rule_config (tenant_id, effective_from, hra_floor_x_minor, hra_floor_y_minor, hra_floor_z_minor,
        dep_allow_same_station_bps, dep_allow_same_station_cap_minor, dep_allow_other_station_bps, dep_allow_other_station_cap_minor, change_reason, created_by)
      VALUES (${TENANT}::uuid, '2026-01-01', 540000, 360000, 180000, 500, 450000, 1000, 900000, 'test fixture rules', ${ACTOR}::uuid)`);
  });
});

afterAll(async () => {
  await asTenant(async (tx) => {
    for (const t of ["statutory.payroll_pf", "statutory.payroll_esi", "statutory.payroll_tds", "statutory.payroll_gpf", "statutory.payroll_nps",
      "statutory.allowance_rule_config", "payroll.payroll_salary_revisions", "payroll.payroll_register", "payroll.payroll_slips", "payroll.payroll_arrears", "payroll.payroll_runs",
      "payroll.payroll_components", "payroll.payroll_structures", "payroll.dearness_allowance_rates"]) {
      await tx.execute(sql.raw(`DELETE FROM ${t} WHERE tenant_id = '${TENANT}'`));
    }
  });
  await app.close();
  await sqlClient.end();
});

describe("mixed-profile salary run", () => {
  it("pays each employee under their own profile in one run", async () => {
    vi.mocked(fetchPayrollInput).mockResolvedValue({ month: MONTH, employees: MIXED, lopDays: { [ids.c]: 3, [ids.a]: 3 }, overtimeHours: {} } as unknown as Awaited<ReturnType<typeof fetchPayrollInput>>);
    const runId = await startRun("PP-MIXED");
    const run = await settle(runId);
    expect(run.status).not.toBe("failed");
    const slips = await q(sql`SELECT employee_no, basic_minor::text, gross_minor::text, net_pay_minor::text, components, gpf_minor::text,
      nps_employee_minor::text, pf_employee_minor::text, pay_profile, profile_snapshot, pf_wage_minor::text
      FROM payroll.payroll_slips WHERE run_id = ${runId}::uuid ORDER BY employee_no`);
    const by = Object.fromEntries(slips.map((s) => [s.employee_no as string, s]));
    const comp = (no: string, code: string) => (by[no]!.components as Array<{ code: string; amountMinor: number }>).find((c) => c.code === code)?.amountMinor;

    // govt_scale: basic 15,000 X @ DA 55% -> slab 4,500 < floor 5,400
    expect(by["PP-G"]).toMatchObject({ pay_profile: "govt_scale", basic_minor: "1500000", pf_wage_minor: null });
    expect(comp("PP-G", "HRA")).toBe(540000);
    expect(comp("PP-G", "TA")).toBe(360000);

    // Option A: parent basic (not the HRMS basic), DEP_ALLOW 10% capped, GPF from the parent scheme
    expect(by["PP-A"]).toMatchObject({ pay_profile: "deputation_parent_scale", basic_minor: "4490000", gpf_minor: "696000", nps_employee_minor: "0" });
    expect(comp("PP-A", "DEP_ALLOW")).toBe(449000);
    expect(comp("PP-A", "HRA")).toBe(898000);
    // 3 LOP days of 30 reduce Basic + DA + DEP_ALLOW pro rata: (44,900 + 24,695 + 4,490) x 3/30 = 7,408.50 -> 7,409
    expect(comp("PP-A", "LOP")).toBe(740900);
    expect(by["PP-A"]!.profile_snapshot).toMatchObject({ deputationId: DEP_ID, direction: "in", allowanceBasis: "computed", allowanceRule: { rateBps: "1000", capMinor: "900000" } });

    // Option B: post basic, no allowance, employee's own NPS
    expect(by["PP-B"]).toMatchObject({ pay_profile: "deputation_post_scale", basic_minor: "4760000", nps_employee_minor: "737800" });
    expect(comp("PP-B", "DEP_ALLOW")).toBeUndefined();

    // consolidated: 30,000 pro-rated 27/30 days, no DA/HRA/TA, EPF on the ceiling, no LOP line
    expect(by["PP-C"]).toMatchObject({ pay_profile: "consolidated_contract", basic_minor: "2700000", gross_minor: "2700000", pf_employee_minor: "180000", nps_employee_minor: "0", pf_wage_minor: "2700000" });
    expect((by["PP-C"]!.components as Array<{ code: string }>).map((c) => c.code)).toEqual(["BASIC"]);
    expect(by["PP-C"]!.profile_snapshot).toMatchObject({ profile: "consolidated_contract", consolidatedMonthlyMinor: "3000000" });

    // the register still aggregates every slip of the run
    const [reg] = await q(sql`SELECT employee_count, total_gross_minor::text FROM payroll.payroll_register WHERE run_id = ${runId}::uuid`);
    const totalGross = slips.reduce((s, x) => s + BigInt(x.gross_minor as string), 0n);
    expect(reg).toMatchObject({ employee_count: 4, total_gross_minor: totalGross.toString() });
  }, 60_000);

  it("fails the run closed, naming the employee, for a ctc_contract profile (CTC module not deployed)", async () => {
    vi.mocked(fetchPayrollInput).mockResolvedValue({
      month: "2026-12", employees: [employee(ids.k, "PP-K", "3000000", "X", "EPF", profile("ctc_contract"))], lopDays: {}, overtimeHours: {},
    } as unknown as Awaited<ReturnType<typeof fetchPayrollInput>>);
    const runId = await startRun("PP-CTC", "2026-12");
    const run = await settle(runId);
    expect(run.status).toBe("failed");
    expect(run.last_error).toContain("CTC_PROFILE_NOT_SUPPORTED");
    expect(run.last_error).toContain("PP-K");
  }, 60_000);
});

describe("retro arrears honour the HRA floor", () => {
  it("floor binds on both sides: HRA delta is floor - floor = 0 (legacy formula would add 30% x delta)", async () => {
    const emp = randomUUID();
    await q(sql`INSERT INTO payroll.payroll_salary_revisions (tenant_id, employee_id, effective_date, old_basic_minor, new_basic_minor, old_gross_minor, new_gross_minor, revision_type)
      VALUES (${TENANT}::uuid, ${emp}::uuid, '2026-11-01', 1400000, 1600000, 0, 0, 'annual_increment')`);
    await asTenant((tx) => generateRetroArrears(tx as unknown as typeof db, TENANT, emp, "2027-01", "X", ACTOR, { hraFloorForPeriod: () => 540_000n }));
    const rows = await q(sql`SELECT from_period, difference_minor::text FROM payroll.payroll_arrears WHERE tenant_id = ${TENANT}::uuid AND employee_id = ${emp}::uuid ORDER BY from_period`);
    // per month: basic +2,000, DA 55% +1,100, HRA max(30%,5,400) both sides = 5,400 -> +0
    expect(rows).toEqual([{ from_period: "2026-11", difference_minor: "310000" }, { from_period: "2026-12", difference_minor: "310000" }]);
  });
  it("no floor (omitted): the exact legacy delta", async () => {
    const emp = randomUUID();
    await q(sql`INSERT INTO payroll.payroll_salary_revisions (tenant_id, employee_id, effective_date, old_basic_minor, new_basic_minor, old_gross_minor, new_gross_minor, revision_type)
      VALUES (${TENANT}::uuid, ${emp}::uuid, '2026-11-01', 1400000, 1600000, 0, 0, 'annual_increment')`);
    await asTenant((tx) => generateRetroArrears(tx as unknown as typeof db, TENANT, emp, "2026-12", "X", ACTOR));
    const rows = await q(sql`SELECT difference_minor::text FROM payroll.payroll_arrears WHERE tenant_id = ${TENANT}::uuid AND employee_id = ${emp}::uuid`);
    expect(rows).toEqual([{ difference_minor: "370000" }]); // 2,000 + 1,100 + 600
  });
  it("Option A with parent DA: priced at the plan's DA rate, plus the DEP_ALLOW delta", async () => {
    const emp = randomUUID();
    await q(sql`INSERT INTO payroll.payroll_salary_revisions (tenant_id, employee_id, effective_date, old_basic_minor, new_basic_minor, old_gross_minor, new_gross_minor, revision_type)
      VALUES (${TENANT}::uuid, ${emp}::uuid, '2026-11-01', 4400000, 4600000, 0, 0, 'annual_increment')`);
    const allowance = { mode: "auto" as const, fixedMinor: 0n, stationType: "other" as const, rule: { rateBps: 1000n, capMinor: 900_000n } };
    await asTenant((tx) => generateRetroArrears(tx as unknown as typeof db, TENANT, emp, "2026-12", "Y", ACTOR, {
      daRateBpsOverride: 4000n,
      deputationAllowanceForPeriod: (_p, basic) => deputationAllowanceMinor(basic, allowance).amountMinor,
    }));
    const rows = await q(sql`SELECT difference_minor::text FROM payroll.payroll_arrears WHERE tenant_id = ${TENANT}::uuid AND employee_id = ${emp}::uuid`);
    // basic +2,000; DA 40% (parent, not the tenant's central 55%) +800; HRA Y tier1 18% +360; DEP_ALLOW 10% +200
    expect(rows).toEqual([{ difference_minor: "336000" }]);
  });
  it("a month paid with no HRA floor configured is flagged on the run's audit trail", async () => {
    vi.mocked(fetchPayrollInput).mockResolvedValue({ month: "2025-12", employees: [employee(ids.g, "PP-G", "1500000", "X", "NPS")], lopDays: {}, overtimeHours: {} } as unknown as Awaited<ReturnType<typeof fetchPayrollInput>>);
    await q(sql`INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps) VALUES (${TENANT}::uuid, '2025-01-01', 5300)`);
    const runId = await startRun("PP-NOFLOOR", "2025-12");
    const run = await settle(runId);
    expect(run.status).not.toBe("failed");
    const warn = await q(sql`SELECT payload FROM _outbox.messages WHERE topic = 'audit.event.record' AND payload->>'resourceId' = ${runId} AND payload->>'action' = 'warning'`);
    expect(warn.map((w) => (w.payload as { code: string }).code)).toEqual(["HRA_FLOOR_NOT_CONFIGURED"]);
    const mixedWarn = await q(sql`SELECT 1 FROM _outbox.messages WHERE topic = 'audit.event.record' AND payload->>'action' = 'warning' AND payload->>'code' = 'HRA_FLOOR_NOT_CONFIGURED' AND payload->>'resourceId' IN (SELECT id::text FROM payroll.payroll_runs WHERE run_no = 'PP-MIXED' AND tenant_id = ${TENANT}::uuid)`);
    expect(mixedWarn).toHaveLength(0);
  });
});

describe("reports", () => {
  it("hra-floor-impact, preflight and foreign-service over the live feed", async () => {
    const feed = [...MIXED.slice(0, 3), employee(ids.k, "PP-K", "3000000", "X", "EPF", profile("ctc_contract"))];
    feed[1] = employee(ids.a, "PP-A", "9999900", "Y", "NPS", profile("deputation_parent_scale", { deputation: deputation({ foreignService: true }) }));
    vi.mocked(fetchPayrollInput).mockResolvedValue({ month: MONTH, employees: feed, lopDays: {}, overtimeHours: {} } as unknown as Awaited<ReturnType<typeof fetchPayrollInput>>);

    const impact = (await app.inject({ method: "GET", url: `/v1/payroll/reports/hra-floor-impact?month=${MONTH}`, headers: hdr(["hr_admin"]) })).json();
    expect(impact.floorsMinor).toEqual({ X: "540000", Y: "360000", Z: "180000" });
    expect(impact.rows.map((r: { employeeNo: string; monthlyIncreaseMinor: string }) => [r.employeeNo, r.monthlyIncreaseMinor])).toEqual([["PP-G", "90000"]]);

    const pre = (await app.inject({ method: "GET", url: `/v1/payroll/runs/preflight?month=${MONTH}`, headers: hdr() })).json();
    expect(pre.blocking).toBe(1);
    expect(pre.issues[0]).toMatchObject({ employeeNo: "PP-K", code: "CTC_PROFILE_NOT_SUPPORTED", severity: "blocking" });

    const fs = (await app.inject({ method: "GET", url: `/v1/payroll/reports/foreign-service?month=${MONTH}`, headers: hdr() })).json();
    expect(fs.data).toEqual([expect.objectContaining({ employeeNo: "PP-A", slipFound: true, basicMinor: "4490000", daMinor: "2469500", contributionBaseMinor: "6959500" })]);
    expect(fs.note).toMatch(/not computed/);

    expect((await app.inject({ method: "GET", url: `/v1/payroll/runs/preflight?month=${MONTH}`, headers: hdr(["employee"]) })).statusCode).toBe(403);
  });
});

describe("allowance-rules API", () => {
  it("GET: resolved rules with sources, history and the VERIFY-marked deputation pre-fill", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/payroll/allowance-rules?asOf=2026-11", headers: hdr(["payroll_officer"]) });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.resolved.hraFloorMinor).toEqual({ X: "540000", Y: "360000", Z: "180000" });
    expect(body.resolved.sources.hraFloor.X).toBe("tenant");
    expect(body.resolved.deputation.otherStation).toEqual({ rateBps: 1000, capMinor: "900000" });
    expect(body.suggestedDeputationRules.note).toMatch(/VERIFY against current DoPT OM/);
  });

  it("POST: payroll_officer refused; locked month refused; otherwise accepted, persisted and audited", async () => {
    const payload = { effectiveFrom: "2027-03-01", hraFloorXMinor: "600000", changeReason: "Revised floor per tenant order 12/2027" };
    expect((await app.inject({ method: "POST", url: "/v1/payroll/allowance-rules", headers: hdr(["payroll_officer"]), payload })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/payroll/allowance-rules", headers: hdr(), payload: { effectiveFrom: "2027-03-01", changeReason: "nothing set at all here" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/v1/payroll/allowance-rules", headers: hdr(), payload: { ...payload, effectiveFrom: "2027-03-15" } })).statusCode).toBe(400);

    await q(sql`INSERT INTO payroll.payroll_runs (id, tenant_id, run_no, month, structure_id, status, created_by, updated_by)
      VALUES (${randomUUID()}::uuid, ${TENANT}::uuid, 'PP-LOCK', '2027-03', ${STRUCTURE}::uuid, 'approved', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    const locked = await app.inject({ method: "POST", url: "/v1/payroll/allowance-rules", headers: hdr(), payload });
    expect(locked.statusCode).toBe(409);
    expect(locked.json().code).toBe("PERIOD_LOCKED");

    const ok = await app.inject({ method: "POST", url: "/v1/payroll/allowance-rules", headers: hdr(["super_admin"]), payload: { ...payload, effectiveFrom: "2027-04-01" } });
    expect(ok.statusCode).toBe(202);
    const deadline = Date.now() + 10_000;
    let rows: Array<Record<string, unknown>> = [];
    while (Date.now() < deadline) {
      rows = await q(sql`SELECT hra_floor_x_minor::text, hra_floor_y_minor, change_reason FROM statutory.allowance_rule_config WHERE tenant_id = ${TENANT}::uuid AND effective_from = '2027-04-01'`);
      if (rows.length) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(rows).toEqual([{ hra_floor_x_minor: "600000", hra_floor_y_minor: null, change_reason: payload.changeReason }]);
    const audits = await q(sql`SELECT payload FROM _outbox.messages WHERE topic = 'audit.event.record'
      AND payload->>'resourceType' = 'allowance_rule_config' AND payload->>'resourceId' = ${ok.json().id as string}`);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.payload).toMatchObject({
      action: "create", effectiveFrom: "2027-04-01", changeReason: payload.changeReason,
      before: { hraFloorMinor: { X: "540000" } }, after: { hraFloorMinor: { X: "600000" } },
    });
    const after = (await app.inject({ method: "GET", url: "/v1/payroll/allowance-rules?asOf=2027-04", headers: hdr() })).json();
    expect(after.resolved.hraFloorMinor).toEqual({ X: "600000", Y: "360000", Z: "180000" });
  }, 30_000);
});
