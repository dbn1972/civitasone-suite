/**
 * S8 G1, owner decisions of 10 Nov 2026 (second set), against a real database (NOBYPASSRLS role, seeds under runWithTenant):
 *  1. TWO pay-group runs, one for regular staff and one for contract/CTC staff, each with its own run (so its own approval and
 *     bank file); a CTC fault stops only the contract group's run. No schema change: the existing pay-group model is used.
 *  2. lop_applicable default through the component API.
 *  3. ESI has no opt-out; the contribution-period rule is the #2487 seam (covered earlier in the period => stays covered).
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
import { registerPayrollConsumers } from "../src/modules/payroll/consumer.js";
import { registerPayComponentConsumers } from "../src/modules/pay-components/consumer.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const FLAG = "S8_CTC_PROFILE_ENABLED";
const G2FLAG = "S8_PAY_COMPONENTS_ENABLED";
const ACTOR = randomUUID();
const CHECKER = randomUUID();
const MONTH = "2026-11";
const DEPT = randomUUID();
const T = { grp: randomUUID(), iso: randomUUID(), esi: randomUUID(), lop: randomUUID() };
const STRUCT: Record<string, string> = { [T.grp]: randomUUID(), [T.iso]: randomUUID(), [T.esi]: randomUUID(), [T.lop]: randomUUID() };
const TPL: Record<string, string> = { [T.grp]: randomUUID(), [T.iso]: randomUUID(), [T.esi]: randomUUID() };
const EMP = { g: randomUUID(), a: randomUUID() };

const hdr = (tid: string, roles = ["payroll_admin"], actor = ACTOR) => ({ authorization: `Bearer ${signToken({ sub: actor, tid, roles, sid: "g1" }, SECRET, 3600)}`, "content-type": "application/json" });
const asTenant = <R>(tid: string, fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<R>) => runWithTenant(tid, () => db.transaction(fn));
const q = async (tid: string, s: ReturnType<typeof sql>) => (await asTenant(tid, (tx) => tx.execute(s))) as unknown as Array<Record<string, unknown>>;
let app: FastifyInstance;

const employee = (id: string, no: string, joined: string, payProfile?: Record<string, unknown>) => ({
  id, employeeNo: no, fullName: no, basicMinor: payProfile ? "100" : "1500000", dateOfJoining: joined, payStructureId: null,
  bankAccountNo: null, bankIfsc: null, pan: null, uan: null, pran: null, cityClass: "X", taxRegime: "new",
  departmentId: DEPT, pensionScheme: payProfile ? "EPF" : "NPS", paymentRoute: "payroll", eligibleForPayroll: true,
  statutoryPf: true, statutoryEsi: true, statutoryNps: true, stateCode: "DL", ...(payProfile ? { payProfile } : {}),
});
const ctcProfile = (tpl: string, annualRupees: number) => ({
  profile: "ctc_contract", source: "assigned", profileId: randomUUID(), effectiveFrom: "2026-11-01", changedWithinMonth: false,
  ctc: { annualFixedMinor: String(annualRupees * 100), annualVariableTargetMinor: null, templateLineageId: tpl, epfWagePolicy: "ceiling", gratuityProvisionOn: true, overrides: [] },
});
const G = () => employee(EMP.g, "DIC-G-0042", "2020-01-01");
const CA = (t: string, rupees = 960_000) => employee(EMP.a, "DIC-C-0917", "2024-04-01", ctcProfile(TPL[t]!, rupees));
const feed = (employees: unknown[]) => vi.mocked(fetchPayrollInput).mockResolvedValue({ month: MONTH, employees, lopDays: {}, overtimeHours: {} } as unknown as Awaited<ReturnType<typeof fetchPayrollInput>>);

async function seedTenant(tid: string, withTemplate: boolean): Promise<void> {
  const st = STRUCT[tid]!;
  await asTenant(tid, async (tx) => {
    await tx.execute(sql`INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps) VALUES (${tid}::uuid, '2026-01-01', 5500)`);
    await tx.execute(sql`INSERT INTO payroll.payroll_structures (id, tenant_id, name, is_default, status, created_by, updated_by) VALUES (${st}::uuid, ${tid}::uuid, 'Deputation Pay', true, 'active', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    await tx.execute(sql`
      INSERT INTO statutory.allowance_rule_config (tenant_id, effective_from, hra_floor_x_minor, hra_floor_y_minor, hra_floor_z_minor,
        dep_allow_same_station_bps, dep_allow_same_station_cap_minor, dep_allow_other_station_bps, dep_allow_other_station_cap_minor, change_reason, created_by)
      VALUES (${tid}::uuid, '2026-01-01', 540000, 360000, 180000, 500, 450000, 1000, 900000, 'fixture rules', ${ACTOR}::uuid)`);
    if (!withTemplate) return;
    const tp = TPL[tid]!;
    await tx.execute(sql`INSERT INTO payroll.payroll_structures (id, tenant_id, name, status, kind, is_locked, effective_from, template_version, lineage_root_id, created_by, updated_by)
      VALUES (${tp}::uuid, ${tid}::uuid, 'Project Staff CTC - Delhi (DIC)', 'active', 'ctc_template', true, '2026-11-01', 1, ${tp}::uuid, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    const c = (code: string, name: string, type: string, calc: string | null, o: Record<string, unknown>) => tx.execute(sql`
      INSERT INTO payroll.payroll_components (tenant_id, structure_id, code, name, component_type, calc, pct_of_basic, pct_of_ctc_bps, employer_cost_class, cost_placement,
        counts_for_pf_wage, counts_for_esi_wage, counts_for_gratuity, lop_applicable, payslip_order, created_by, updated_by)
      VALUES (${tid}::uuid, ${tp}::uuid, ${code}, ${name}, ${type}, ${calc}, ${(o.pctOfBasic as number) ?? null}, ${(o.bps as number) ?? null}, ${(o.cls as string) ?? null}, 'inside_ctc',
        ${o.pf === true}, true, ${o.grat === true}, ${o.lop !== false}, ${o.order as number}, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    await c("BASIC", "Basic Pay", "earning", "pct_of_ctc", { bps: 5000, pf: true, grat: true, order: 10 });
    await c("HRA", "House Rent Allowance", "earning", "pct_of_basic", { pctOfBasic: 50, order: 20 });
    await c("SPECIAL", "Special Allowance", "earning", "balancing", { order: 30 });
    await c("ER_PF", "Employer PF", "employer_cost", null, { cls: "employer_pf", lop: false, order: 40 });
    await c("ER_ESI", "Employer ESI", "employer_cost", null, { cls: "employer_esi", lop: false, order: 45 });
    await c("GRATUITY", "Gratuity provision", "employer_cost", "pct_of_basic", { pctOfBasic: 4.81, cls: "gratuity_provision", lop: false, order: 50 });
  });
}
async function startRun(tid: string, runNo: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/v1/payroll/runs", headers: hdr(tid), payload: { runNo, month: MONTH, structureId: STRUCT[tid], ...extra } });
  expect([201, 202]).toContain(res.statusCode);
  return res.json().data?.id ?? res.json().id;
}
async function settle(tid: string, runId: string): Promise<{ status: string; last_error: string | null }> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    await new Promise((r) => setTimeout(r, 250));
    const [run] = await q(tid, sql`SELECT status, last_error FROM payroll.payroll_runs WHERE id = ${runId}::uuid`);
    const regs = await q(tid, sql`SELECT 1 FROM payroll.payroll_register WHERE run_id = ${runId}::uuid LIMIT 1`);
    if (run?.status === "failed" || regs.length > 0) return run as { status: string; last_error: string | null };
    if (Date.now() > deadline) throw new Error("run did not settle");
  }
}
const slipNos = async (tid: string, runId: string) =>
  (await q(tid, sql`SELECT employee_no FROM payroll.payroll_slips WHERE run_id = ${runId}::uuid ORDER BY employee_no`)).map((r) => r.employee_no);
async function seedGroups(tid: string): Promise<{ regular: string; contract: string }> {
  const regular = randomUUID(), contract = randomUUID();
  await asTenant(tid, async (tx) => {
    await tx.execute(sql`INSERT INTO payroll.pay_groups (id, tenant_id, name, created_by, updated_by) VALUES (${regular}::uuid, ${tid}::uuid, 'Regular staff (deputation and permanent)', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    await tx.execute(sql`INSERT INTO payroll.pay_groups (id, tenant_id, name, bill_type, created_by, updated_by) VALUES (${contract}::uuid, ${tid}::uuid, 'Contract and CTC staff', 'contract', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    await tx.execute(sql`INSERT INTO payroll.employee_pay_group_assignments (tenant_id, employee_id, pay_group_id, effective_from, created_by) VALUES (${tid}::uuid, ${EMP.g}::uuid, ${regular}::uuid, '2026-01-01', ${ACTOR}::uuid)`);
    await tx.execute(sql`INSERT INTO payroll.employee_pay_group_assignments (tenant_id, employee_id, pay_group_id, effective_from, created_by) VALUES (${tid}::uuid, ${EMP.a}::uuid, ${contract}::uuid, '2026-01-01', ${ACTOR}::uuid)`);
  });
  return { regular, contract };
}

beforeAll(async () => {
  process.env[FLAG] = "true";
  const rawSubscribe = queue.subscribe.bind(queue);
  (queue as unknown as { subscribe: typeof queue.subscribe }).subscribe = ((topic: string, handler: (msg: { tenantId: string }) => Promise<void>) =>
    rawSubscribe(topic, (msg: { tenantId: string }) => runWithTenant(msg.tenantId, () => handler(msg)))) as unknown as typeof queue.subscribe;
  registerPayrollConsumers(queue);
  registerPayComponentConsumers(queue);
  await queue.start();
  app = await buildApp();
  await seedTenant(T.grp, true);
  await seedTenant(T.iso, false);
  await seedTenant(T.esi, true);
  await seedTenant(T.lop, false);
});
afterAll(async () => {
  delete process.env[FLAG]; delete process.env[G2FLAG];
  for (const tid of Object.values(T)) {
    await asTenant(tid, async (tx) => {
      for (const t of ["statutory.payroll_pf", "statutory.payroll_esi", "statutory.payroll_tds", "statutory.payroll_gpf", "statutory.payroll_nps", "statutory.allowance_rule_config",
        "payroll.employee_pay_group_assignments", "payroll.payroll_register", "payroll.payroll_slips", "payroll.payroll_arrears", "payroll.payroll_runs", "payroll.pay_groups",
        "payroll.payroll_statutory_seams", "payroll.payroll_components", "payroll.payroll_structures", "payroll.dearness_allowance_rates"]) {
        await tx.execute(sql.raw(`DELETE FROM ${t} WHERE tenant_id = '${tid}'`));
      }
    });
  }
  await app.close();
  await sqlClient.end();
});

describe("decision 1: two pay-group runs (regular staff, contract/CTC staff)", () => {
  it("each group's run pays only its members, as a run of its own (own register, own approval and bank file)", async () => {
    const g = await seedGroups(T.grp);
    feed([G(), CA(T.grp)]);
    const r1 = await startRun(T.grp, "S8-GRP-REG", { payGroupId: g.regular });
    expect((await settle(T.grp, r1)).status).not.toBe("failed");
    const r2 = await startRun(T.grp, "S8-GRP-CTC", { payGroupId: g.contract });
    expect((await settle(T.grp, r2)).status).not.toBe("failed");
    expect(r1).not.toBe(r2);
    expect(await slipNos(T.grp, r1)).toEqual(["DIC-G-0042"]);
    expect(await slipNos(T.grp, r2)).toEqual(["DIC-C-0917"]);
    const runs = await q(T.grp, sql`SELECT id::text, pay_group_id::text, status FROM payroll.payroll_runs WHERE tenant_id = ${T.grp}::uuid ORDER BY run_no`);
    expect(runs.map((r) => r.pay_group_id)).toEqual([g.contract, g.regular]);
    const regs = await q(T.grp, sql`SELECT run_id::text, employee_count FROM payroll.payroll_register WHERE tenant_id = ${T.grp}::uuid`);
    expect(regs.map((r) => r.employee_count)).toEqual([1, 1]);
    // the contract group's slip is the CTC slip; the regular group's is the government one
    const [ctc] = await q(T.grp, sql`SELECT pay_profile, gross_minor::text FROM payroll.payroll_slips WHERE run_id = ${r2}::uuid`);
    expect(ctc).toMatchObject({ pay_profile: "ctc_contract", gross_minor: "7627600" }); // 40,000 + 20,000 + 16,276 (no group insurance in this template)
    const [reg] = await q(T.grp, sql`SELECT pay_profile FROM payroll.payroll_slips WHERE run_id = ${r1}::uuid`);
    expect(reg).toMatchObject({ pay_profile: "govt_scale" });
  }, 90_000);

  it("a CTC fault (no locked template) fails only the contract group's run; the regular group is paid", async () => {
    const g = await seedGroups(T.iso);
    feed([G(), CA(T.iso)]);
    const ok = await startRun(T.iso, "S8-ISO-REG", { payGroupId: g.regular });
    expect((await settle(T.iso, ok)).status).not.toBe("failed");
    expect(await slipNos(T.iso, ok)).toEqual(["DIC-G-0042"]);
    const bad = await startRun(T.iso, "S8-ISO-CTC", { payGroupId: g.contract });
    const run = await settle(T.iso, bad);
    expect(run.status).toBe("failed");
    expect(run.last_error).toContain("CTC_TEMPLATE_NOT_FOUND");
    expect(run.last_error).toContain("DIC-C-0917");
  }, 90_000);
});

describe("decision 3: no ESI opt-out; contribution period = the #2487 seam", () => {
  // Rs 2,76,000 on this template (no group insurance) solves to full-month gross 21,067: just OVER the Rs 21,000 ceiling, so ESI is off at solve time.
  const lowCtc = () => CA(T.esi, 276_000);
  it("seam on: covered earlier in the Oct-Mar period, a one-off lifts the gross over the ceiling, ESI stays on the booked gross", async () => {
    const prior = randomUUID();
    await q(T.esi, sql`INSERT INTO payroll.payroll_statutory_seams (tenant_id, esi_contribution_period_enabled) VALUES (${T.esi}::uuid, true)`);
    await q(T.esi, sql`INSERT INTO payroll.payroll_runs (id, tenant_id, run_no, month, structure_id, run_type, ddo_code, status, created_by, updated_by)
      VALUES (${prior}::uuid, ${T.esi}::uuid, 'S8-ESI-OCT', '2026-10', ${STRUCT[T.esi]}::uuid, 'regular', 'S8-ESI-OCT', 'disbursed', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    await q(T.esi, sql`INSERT INTO payroll.payroll_slips (tenant_id, run_id, employee_id, employee_no, basic_minor, gross_minor, esi_minor, net_pay_minor, components, status, created_by, updated_by)
      VALUES (${T.esi}::uuid, ${prior}::uuid, ${EMP.a}::uuid, 'DIC-C-0917', 1150000, 1992000, 14940, 1900000, '[]'::jsonb, 'computed', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    await q(T.esi, sql`INSERT INTO payroll.payroll_arrears (tenant_id, employee_id, component_code, from_period, to_period, old_amount_minor, new_amount_minor, difference_minor, status, source, created_by)
      VALUES (${T.esi}::uuid, ${EMP.a}::uuid, 'PERF_BONUS', '2026-10', '2026-10', 0, 0, 500000, 'approved', 'manual', ${ACTOR}::uuid)`);
    feed([lowCtc()]);
    const runId = await startRun(T.esi, "S8-ESI-NOV");
    expect((await settle(T.esi, runId)).status).not.toBe("failed");
    const [s] = await q(T.esi, sql`SELECT gross_minor::text, esi_minor::text, employer_esi_minor::text, profile_snapshot FROM payroll.payroll_slips WHERE run_id = ${runId}::uuid`);
    // This template has no group insurance: Rs 2,76,000 solves to gross 21,067 with ESI OFF (just over the ceiling), + the Rs 5,000 one-off = 26,067.
    // Covered earlier in the period, so ESI continues on the booked gross: employee 0.75% -> 196, employer 3.25% -> 847.
    expect(s).toMatchObject({ gross_minor: "2606700", esi_minor: "19600", employer_esi_minor: "84700" });
    expect((s!.profile_snapshot as { ctcBooked: { employerEsiMinor: string } }).ctcBooked.employerEsiMinor).toBe("84700");
  }, 60_000);

  it("the CTC terms have no opt-out field: the feed schema drops it and HRMS refuses it (see the hrms tests)", async () => {
    const { payProfileFeedSchema } = await import("../src/shared/hrms-client.js");
    const parsed = payProfileFeedSchema.parse({ ...ctcProfile(TPL[T.esi]!, 276_000), ctc: { ...ctcProfile(TPL[T.esi]!, 276_000).ctc, esiOptOut: true } });
    expect((parsed.ctc as Record<string, unknown>).esiOptOut).toBeUndefined();
  });
});

describe("decision 2: lop_applicable default through the component API", () => {
  it("omitted => true for template earnings, false for a fixed reimbursement and for employer costs; explicit wins", async () => {
    process.env[G2FLAG] = "true";
    const maker = hdr(T.lop, ["payroll_officer"], ACTOR);
    const created = await app.inject({ method: "POST", url: "/v1/payroll/ctc-templates", headers: maker, payload: { name: "Project Staff CTC - Delhi (DIC)", effectiveFrom: "2026-12-01" } });
    expect(created.statusCode).toBe(202);
    const sid = created.json().id as string;
    for (let i = 0; i < 100; i++) { if ((await q(T.lop, sql`SELECT 1 FROM payroll.payroll_structures WHERE id = ${sid}::uuid`)).length) break; await new Promise((r) => setTimeout(r, 50)); }
    const add = (body: object) => app.inject({ method: "POST", url: `/v1/payroll/structures/${sid}/components`, headers: maker, payload: body as object });
    expect((await add({ code: "BASIC", name: "Basic Pay", calc: "pct_of_ctc", pctOfCtcBps: 5000 })).statusCode).toBe(202);
    expect((await add({ code: "PHONE", name: "Phone reimbursement", calc: "fixed", fixedMinor: "100000" })).statusCode).toBe(202);
    expect((await add({ code: "CONVEYANCE", name: "Conveyance allowance", calc: "fixed", fixedMinor: "160000", isTaxable: true })).statusCode).toBe(202);
    expect((await add({ code: "GRATUITY", name: "Gratuity provision", calc: "pct_of_basic", pctOfBasic: 4.81, employerCostClass: "gratuity_provision" })).statusCode).toBe(202);
    expect((await add({ code: "BOOK_ALLOW", name: "Books allowance", calc: "fixed", fixedMinor: "50000", lopApplicable: true })).statusCode).toBe(202);
    let rows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 100; i++) { rows = await q(T.lop, sql`SELECT code, lop_applicable FROM payroll.payroll_components WHERE structure_id = ${sid}::uuid`); if (rows.length === 5) break; await new Promise((r) => setTimeout(r, 50)); }
    const lop = Object.fromEntries(rows.map((r) => [r.code as string, r.lop_applicable]));
    expect(lop).toEqual({ BASIC: true, PHONE: false, CONVEYANCE: true, GRATUITY: false, BOOK_ALLOW: true });
  }, 60_000);
});
