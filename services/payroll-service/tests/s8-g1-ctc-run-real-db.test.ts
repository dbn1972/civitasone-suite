/**
 * S8 G1 end to end against a real database (NOBYPASSRLS role, RLS forced, seeds written under the tenant context)
 * and the real run consumer. One run mixes 1 government-scale employee with 2 ctc_contract employees; the
 * government employee's slip must be IDENTICAL to the slip of the same employee in a run without the CTC staff.
 * Fixture figures: DIC-style test data, Delhi metro, statutory config = defaults (all VERIFY).
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
import { fetchPayrollInput, payProfileFeedSchema } from "../src/shared/hrms-client.js";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerPayrollConsumers } from "../src/modules/payroll/consumer.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const FLAG = "S8_CTC_PROFILE_ENABLED";
const ACTOR = randomUUID();
const MONTH = "2026-11"; // 30 days
const DEPT = randomUUID();
const T_MIXED = randomUUID();
const T_GOVT_ONLY = randomUUID();
const T_BARE = randomUUID(); // no template at all
const T_OFF = randomUUID(); // template present, flag off

const tok = (tid: string) => signToken({ sub: ACTOR, tid, roles: ["payroll_admin"], sid: "ctc" }, SECRET, 3600);
const hdr = (tid: string) => ({ authorization: `Bearer ${tok(tid)}`, "content-type": "application/json" });
const asTenant = <T>(tid: string, fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
  runWithTenant(tid, () => db.transaction(fn));
const q = async (tid: string, s: ReturnType<typeof sql>) => (await asTenant(tid, (tx) => tx.execute(s))) as unknown as Array<Record<string, unknown>>;

const S = { mixed: randomUUID(), govtOnly: randomUUID(), bare: randomUUID(), off: randomUUID() }; // run structures
const TPLS: Record<string, string> = { [T_MIXED]: randomUUID(), [T_GOVT_ONLY]: randomUUID(), [T_BARE]: randomUUID(), [T_OFF]: randomUUID() }; // template lineage roots (global PK)
const EMP = { g: randomUUID(), a: randomUUID(), b: randomUUID(), k: randomUUID() };

const employee = (id: string, no: string, basic: string, joined: string, payProfile?: Record<string, unknown>) => ({
  id, employeeNo: no, fullName: no, basicMinor: basic, dateOfJoining: joined, payStructureId: null,
  bankAccountNo: null, bankIfsc: null, pan: null, uan: null, pran: null, cityClass: "X", taxRegime: "new",
  departmentId: DEPT, pensionScheme: payProfile ? "EPF" : "NPS", paymentRoute: "payroll", eligibleForPayroll: true,
  statutoryPf: true, statutoryEsi: true, statutoryNps: true, stateCode: "DL", ...(payProfile ? { payProfile } : {}),
});
const ctcProfile = (tpl: string, annualRupees: number, o: Record<string, unknown> = {}) => ({
  profile: "ctc_contract", source: "assigned", profileId: randomUUID(), effectiveFrom: "2026-11-01", changedWithinMonth: false,
  ctc: {
    annualFixedMinor: String(annualRupees * 100), annualVariableTargetMinor: null, templateLineageId: tpl,
    epfWagePolicy: "ceiling", esiOptOut: false, gratuityProvisionOn: true, overrides: [], ...o,
  },
});
const G = () => employee(EMP.g, "DIC-G-0042", "1500000", "2020-01-01");
const CA = (t: string) => employee(EMP.a, "DIC-C-0917", "100", "2024-04-01", ctcProfile(TPLS[t]!, 960_000));
const CB = (t: string) => employee(EMP.b, "DIC-C-1203", "100", "2026-11-11", ctcProfile(TPLS[t]!, 1_800_000, { epfWagePolicy: "actual" })); // joins 11 Nov: 10 of 30 days unpaid

let app: FastifyInstance;

async function seedTenant(T: string, structure: string, withTemplate: boolean): Promise<void> {
  await asTenant(T, async (tx) => {
    await tx.execute(sql`INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps) VALUES (${T}::uuid, '2026-01-01', 5500)`);
    await tx.execute(sql`INSERT INTO payroll.payroll_structures (id, tenant_id, name, is_default, status, created_by, updated_by) VALUES (${structure}::uuid, ${T}::uuid, 'Deputation Pay', true, 'active', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    await tx.execute(sql`INSERT INTO payroll.payroll_components (tenant_id, structure_id, code, name, component_type, fixed_minor, created_by, updated_by) VALUES (${T}::uuid, ${structure}::uuid, 'TA', 'Transport Allowance', 'earning', 360000, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    await tx.execute(sql`
      INSERT INTO statutory.allowance_rule_config (tenant_id, effective_from, hra_floor_x_minor, hra_floor_y_minor, hra_floor_z_minor,
        dep_allow_same_station_bps, dep_allow_same_station_cap_minor, dep_allow_other_station_bps, dep_allow_other_station_cap_minor, change_reason, created_by)
      VALUES (${T}::uuid, '2026-01-01', 540000, 360000, 180000, 500, 450000, 1000, 900000, 'test fixture rules', ${ACTOR}::uuid)`);
    if (!withTemplate) return;
    // The LOCKED template version in force (G2): BASIC 50% of CTC, HRA 50% of basic, gratuity 4.81% of basic (the owner's
    // starting value), Rs 500 group insurance, employer PF and ESI inside CTC, SPECIAL = balancing. Test data; VERIFY.
    await tx.execute(sql`INSERT INTO payroll.payroll_structures (id, tenant_id, name, status, kind, is_locked, effective_from, template_version, lineage_root_id, created_by, updated_by)
      VALUES (${TPLS[T]!}::uuid, ${T}::uuid, 'Project Staff CTC - Delhi', 'active', 'ctc_template', true, '2026-11-01', 1, ${TPLS[T]!}::uuid, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    const c = (code: string, name: string, type: string, calc: string | null, o: Record<string, unknown>) => tx.execute(sql`
      INSERT INTO payroll.payroll_components (tenant_id, structure_id, code, name, component_type, calc, pct_of_basic, pct_of_ctc_bps, fixed_minor, employer_cost_class, cost_placement,
        counts_for_pf_wage, counts_for_esi_wage, counts_for_gratuity, lop_applicable, payslip_order, created_by, updated_by)
      VALUES (${T}::uuid, ${TPLS[T]!}::uuid, ${code}, ${name}, ${type}, ${calc}, ${(o.pctOfBasic as number) ?? null}, ${(o.bps as number) ?? null}, ${(o.fixed as number) ?? null},
        ${(o.cls as string) ?? null}, ${(o.placement as string) ?? "inside_ctc"}, ${o.pf === true}, ${o.esi !== false}, ${o.grat === true}, ${o.lop !== false}, ${(o.order as number) ?? null}, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    await c("BASIC", "Basic", "earning", "pct_of_ctc", { bps: 5000, pf: true, grat: true, order: 1 });
    await c("HRA", "House Rent Allowance", "earning", "pct_of_basic", { pctOfBasic: 50, order: 2 });
    await c("SPECIAL", "Special Allowance", "earning", "balancing", { order: 3 });
    await c("GRATUITY", "Gratuity provision", "employer_cost", "pct_of_basic", { pctOfBasic: 4.81, cls: "gratuity_provision", lop: false });
    await c("GROUP_INS", "Group insurance", "employer_cost", "fixed", { fixed: 50000, cls: "group_insurance", lop: false });
    await c("ER_PF", "Employer PF", "employer_cost", null, { cls: "employer_pf", lop: false });
    await c("ER_ESI", "Employer ESI", "employer_cost", null, { cls: "employer_esi", lop: false });
  });
}

async function startRun(T: string, structure: string, runNo: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/v1/payroll/runs", headers: hdr(T), payload: { runNo, month: MONTH, structureId: structure } });
  expect([201, 202]).toContain(res.statusCode);
  return res.json().data?.id ?? res.json().id;
}
async function settle(T: string, runId: string): Promise<{ status: string; last_error: string | null }> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    await new Promise((r) => setTimeout(r, 250));
    const [run] = await q(T, sql`SELECT status, last_error FROM payroll.payroll_runs WHERE id = ${runId}::uuid`);
    const regs = await q(T, sql`SELECT 1 FROM payroll.payroll_register WHERE run_id = ${runId}::uuid LIMIT 1`);
    if (run?.status === "failed" || regs.length > 0) return run as { status: string; last_error: string | null };
    if (Date.now() > deadline) throw new Error("run did not settle");
  }
}
const feed = (employees: unknown[], lopDays: Record<string, number> = {}) =>
  vi.mocked(fetchPayrollInput).mockResolvedValue({ month: MONTH, employees, lopDays, overtimeHours: {} } as unknown as Awaited<ReturnType<typeof fetchPayrollInput>>);
const SLIP_COLS = sql`employee_no, basic_minor::text, gross_minor::text, total_deductions_minor::text, net_pay_minor::text, components, pf_employee_minor::text, pf_employer_minor::text,
  gpf_minor::text, nps_employee_minor::text, nps_employer_minor::text, esi_minor::text, tds_minor::text, status, pay_profile, profile_snapshot, pf_wage_minor::text,
  tds_presumed_months, tds_excess_minor::text, tds_shortfall_minor::text, recovery_deferred_minor::text,
  ctc_template_id::text, ctc_template_version, employer_esi_minor::text, gratuity_provision_minor::text`;
const slipsOf = async (T: string, runId: string) => {
  const rows = await q(T, sql`SELECT ${SLIP_COLS} FROM payroll.payroll_slips WHERE run_id = ${runId}::uuid ORDER BY employee_no`);
  return Object.fromEntries(rows.map((r) => [r.employee_no as string, r]));
};
const comps = (s: Record<string, unknown>) => Object.fromEntries((s.components as Array<{ code: string; amountMinor: number }>).map((c) => [c.code, c.amountMinor]));

beforeAll(async () => {
  process.env[FLAG] = "true";
  const rawSubscribe = queue.subscribe.bind(queue);
  (queue as unknown as { subscribe: typeof queue.subscribe }).subscribe = ((topic: string, handler: (msg: { tenantId: string }) => Promise<void>) =>
    rawSubscribe(topic, (msg: { tenantId: string }) => runWithTenant(msg.tenantId, () => handler(msg)))) as unknown as typeof queue.subscribe;
  registerPayrollConsumers(queue);
  await queue.start();
  app = await buildApp();
  await seedTenant(T_MIXED, S.mixed, true);
  await seedTenant(T_GOVT_ONLY, S.govtOnly, true);
  await seedTenant(T_BARE, S.bare, false);
  await seedTenant(T_OFF, S.off, true);
});

afterAll(async () => {
  delete process.env[FLAG];
  for (const T of [T_MIXED, T_GOVT_ONLY, T_BARE, T_OFF]) {
    await asTenant(T, async (tx) => {
      for (const t of ["statutory.payroll_pf", "statutory.payroll_esi", "statutory.payroll_tds", "statutory.payroll_gpf", "statutory.payroll_nps",
        "statutory.allowance_rule_config", "payroll.payroll_register", "payroll.payroll_slips", "payroll.payroll_arrears", "payroll.payroll_runs",
        "payroll.payroll_components", "payroll.payroll_structures", "payroll.dearness_allowance_rates"]) {
        await tx.execute(sql.raw(`DELETE FROM ${t} WHERE tenant_id = '${T}'`));
      }
    });
  }
  await app.close();
  await sqlClient.end();
});

describe("feed contract", () => {
  it("payroll accepts the CTC block HRMS sends and rejects a malformed one at the boundary", () => {
    const ok = ctcProfile(randomUUID(), 960_000);
    expect(payProfileFeedSchema.safeParse(ok).success).toBe(true);
    expect(payProfileFeedSchema.safeParse({ ...ok, ctc: { ...ok.ctc, annualFixedMinor: "9.6 lakh" } }).success).toBe(false);
    expect(payProfileFeedSchema.safeParse({ ...ok, ctc: { ...ok.ctc, templateLineageId: "not-a-uuid" } }).success).toBe(false);
    expect(payProfileFeedSchema.safeParse({ ...ok, ctc: { ...ok.ctc, epfWagePolicy: "sometimes" } }).success).toBe(false);
  });
});

describe("mixed run: 1 govt_scale + 2 ctc_contract in ONE run (flag on)", () => {
  let mixedRun = "";
  let govtOnlyRun = "";

  it("pays each employee under their own profile; the CTC slips equal the hand-computed solver figures", async () => {
    feed([G(), CA(T_MIXED), CB(T_MIXED)], { [EMP.a]: 0 });
    mixedRun = await startRun(T_MIXED, S.mixed, "S8-MIXED");
    const run = await settle(T_MIXED, mixedRun);
    expect(run.status).not.toBe("failed");
    const by = await slipsOf(T_MIXED, mixedRun);

    // CTC employee A: Rs 9,60,000, full month. Solver golden G1: BASIC 40,000 | HRA 20,000 | SPECIAL 15,776 | gross 75,776.
    const a = by["DIC-C-0917"]!;
    expect(a).toMatchObject({ pay_profile: "ctc_contract", basic_minor: "4000000", gross_minor: "7577600", pf_employee_minor: "180000", pf_employer_minor: "180000", pf_wage_minor: "1500000", esi_minor: "0", nps_employee_minor: "0", ctc_template_version: 1, employer_esi_minor: "0", gratuity_provision_minor: "192400" });
    expect(a.ctc_template_id).toBe(TPLS[T_MIXED]);
    expect(comps(a)).toMatchObject({ BASIC: 4000000, HRA: 2000000, SPECIAL: 1577600 });
    expect(Object.keys(comps(a)).filter((c) => !["BASIC", "HRA", "SPECIAL", "TDS", "PT", "LWF"].includes(c))).toEqual([]); // no run-structure TA, no DA, no LOP line
    expect(BigInt(a.net_pay_minor as string)).toBe(BigInt(a.gross_minor as string) - BigInt(a.total_deductions_minor as string));

    // CTC employee B: Rs 18,00,000, EPF on actual basic, joins 11 Nov (20 of 30 days paid). Full month (solver, actual PF):
    // BASIC 75,000 | HRA 37,500 | SPECIAL 24,392. x 2/3 -> 50,000 | 25,000 | 16,261 | gross 91,261. PF 12% x 50,000 = 6,000 (uncapped wage).
    const b = by["DIC-C-1203"]!;
    expect(b).toMatchObject({ pay_profile: "ctc_contract", basic_minor: "5000000", gross_minor: "9126100", pf_employee_minor: "600000", pf_employer_minor: "600000", pf_wage_minor: "5000000", gratuity_provision_minor: "240500" });
    expect(comps(b)).toMatchObject({ BASIC: 5000000, HRA: 2500000, SPECIAL: 1626100 });
    expect((b.profile_snapshot as { ctc: { paid: { notInServiceDays: number } } }).ctc.paid.notInServiceDays).toBe(10);

    // the solver's employer figures are the figures the engine booked
    for (const s of [a, b]) {
      const paid = (s.profile_snapshot as { ctc: { paid: { employerPfMinor: string; employerEsiMinor: string; gratuityProvisionMinor: string } } }).ctc.paid;
      expect(paid.employerPfMinor).toBe(s.pf_employer_minor);
      expect(paid.employerEsiMinor).toBe(s.employer_esi_minor);
      expect(paid.gratuityProvisionMinor).toBe(s.gratuity_provision_minor);
    }

    // government employee: still run structure + central DA + HRA floor, NPS, no CTC columns
    const g = by["DIC-G-0042"]!;
    expect(g).toMatchObject({ pay_profile: "govt_scale", ctc_template_id: null, ctc_template_version: null, employer_esi_minor: null, gratuity_provision_minor: null, pf_employee_minor: "0" });
    expect(comps(g)).toMatchObject({ BASIC: 1500000, HRA: 540000, TA: 360000 });

    // the register aggregates all three
    const [reg] = await q(T_MIXED, sql`SELECT employee_count, total_gross_minor::text FROM payroll.payroll_register WHERE run_id = ${mixedRun}::uuid`);
    const total = Object.values(by).reduce((s, x) => s + BigInt(x.gross_minor as string), 0n);
    expect(reg).toMatchObject({ employee_count: 3, total_gross_minor: total.toString() });
  }, 90_000);

  it("NO-CHANGE PROOF: the government employee's slip is identical to the same run without the CTC employees", async () => {
    feed([G()]);
    govtOnlyRun = await startRun(T_GOVT_ONLY, S.govtOnly, "S8-GOVT");
    const run = await settle(T_GOVT_ONLY, govtOnlyRun);
    expect(run.status).not.toBe("failed");
    const mixed = (await slipsOf(T_MIXED, mixedRun))["DIC-G-0042"]!;
    const alone = (await slipsOf(T_GOVT_ONLY, govtOnlyRun))["DIC-G-0042"]!;
    expect(mixed).toEqual(alone); // every column, the component lines and the profile snapshot
  }, 90_000);
});

describe("flag off (the default) and fail-closed behaviour", () => {
  it("flag off: a ctc_contract profile is refused exactly as before, naming the employee", async () => {
    delete process.env[FLAG];
    try {
      feed([CA(T_OFF)]);
      const runId = await startRun(T_OFF, S.off, "S8-FLAGOFF");
      const run = await settle(T_OFF, runId);
      expect(run.status).toBe("failed");
      expect(run.last_error).toContain("CTC_PROFILE_NOT_SUPPORTED");
      expect(run.last_error).toContain("DIC-C-0917");
    } finally { process.env[FLAG] = "true"; }
  }, 60_000);

  it("flag on, no locked template covers the month: the run fails closed naming the employee and the code", async () => {
    feed([CA(T_BARE)]);
    const runId = await startRun(T_BARE, S.bare, "S8-NOTPL");
    const run = await settle(T_BARE, runId);
    expect(run.status).toBe("failed");
    expect(run.last_error).toContain("CTC_TEMPLATE_NOT_FOUND");
    expect(run.last_error).toContain("DIC-C-0917");
  }, 60_000);
});
