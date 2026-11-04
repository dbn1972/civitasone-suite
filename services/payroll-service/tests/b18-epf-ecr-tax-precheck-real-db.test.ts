/**
 * UAT b18 (EPF for contract staff, 2026-11-05) -- real Postgres.
 *   D6  the slip PF wage is the capped wage actually used (Rs 15,000, not 28,440).
 *   D5  the PF ledger row carries EPF / EDLI wages and the employer EDLI and
 *       admin charges; GET /statutory/pf/challan gives A/c 1/2/10/21/22.
 *   D3  GET /statutory/ecr refuses (422 UAN_MISSING, listing the members)
 *       while any EPF member has a missing or invalid UAN.
 *   D4  with valid UANs the ECR is ECR 2.0: "#~#", 11 fields per line.
 *   D2  POST /v1/payroll/runs for an FY with no tax slab config -> 422
 *       TAX_CONFIG_MISSING at creation (no run row is written).
 *   D1  GET /reports/pension-scheme-retro lists already-computed slips under
 *       another scheme, report only.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { payrollRuns, payrollSlips, payrollStructures } from "../src/modules/payroll/schema.js";
import { payrollPf, payrollTds, payrollNps, payrollUpsPool } from "../src/modules/statutory/schema.js";
import { sumEmployerChargesByRunTx } from "../src/modules/statutory/repo.js";
import { computeAndInsertSlip } from "../src/modules/payroll/consumer.js";
import { buildApp } from "../src/app.js";

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return { ...actual, fetchPayrollInput: vi.fn() };
});
import { fetchPayrollInput } from "../src/shared/hrms-client.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const RUN = randomUUID();
const STRUCT = randomUUID();
const MONTH = "2027-02";
const EMP = Array.from({ length: 3 }, (_, i) => ({ id: randomUUID(), no: `B18-EPF-${i + 1}` }));
const UPS_EMP = { id: randomUUID(), no: "B18-UPS-1" };
const auth = { authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["payroll_admin"], sid: "b18" }, SECRET)}` };
const asTenant = <T>(fn: (tx: typeof db) => Promise<T>): Promise<T> => runWithTenant(TENANT, () => db.transaction((tx) => fn(tx as unknown as typeof db)));

function feed(uans: Array<string | null>, regimes: Array<"old" | "new"> = []) {
  (fetchPayrollInput as ReturnType<typeof vi.fn>).mockResolvedValue({
    month: MONTH, lopDays: {},
    employees: EMP.map((e, i) => ({
      id: e.id, employeeNo: e.no, fullName: `Contract Staff ${i + 1}`, basicMinor: "1800000", dateOfJoining: "2026-10-28",
      payStructureId: null, bankAccountNo: null, bankIfsc: null, pan: null, uan: uans[i] ?? null,
      cityClass: "X", taxRegime: regimes[i] ?? "new", departmentId: randomUUID(), pensionScheme: "EPF",
    })),
  });
}

async function wipe(): Promise<void> {
  await asTenant(async (tx) => {
    for (const t of [payrollPf, payrollNps, payrollUpsPool, payrollTds]) await tx.delete(t).where(eq(t.tenantId, TENANT));
    await tx.delete(payrollSlips).where(eq(payrollSlips.tenantId, TENANT));
    await tx.delete(payrollRuns).where(eq(payrollRuns.tenantId, TENANT));
    await tx.delete(payrollStructures).where(eq(payrollStructures.tenantId, TENANT));
    await tx.execute(sql`DELETE FROM payroll.tax_slab_config WHERE tenant_id = ${TENANT}::uuid`);
    await tx.execute(sql`DELETE FROM payroll.payroll_tax_declarations WHERE tenant_id = ${TENANT}::uuid`);
  });
}

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  await wipe();
  await asTenant(async (tx) => {
    await tx.insert(payrollStructures).values({ id: STRUCT, tenantId: TENANT, name: "B18 Structure", isDefault: true, status: "active", createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(payrollRuns).values({ id: RUN, tenantId: TENANT, runNo: "B18-EPF-2027-02", month: MONTH, structureId: STRUCT,
      totalGrossMinor: 0n, totalNetMinor: 0n, currency: "INR", status: "approved", createdBy: ACTOR, updatedBy: ACTOR });
    // The UAT contract employees: Basic Rs 18,000, DA 58% -> Basic + DA Rs 28,440.
    for (const e of EMP) {
      await computeAndInsertSlip(tx as never, { actorId: ACTOR }, {
        runId: RUN, tenantId: TENANT, employeeId: e.id, employeeNo: e.no, basicMinor: 1_800_000n, month: MONTH,
        pensionScheme: "EPF", daRateBps: 5800n, cityClass: "X", taxRegime: "new", fyStartYear: 2026,
      });
    }
    // A UPS member: Basic Rs 50,000, DA 58% -> pension base Rs 79,000.
    await computeAndInsertSlip(tx as never, { actorId: ACTOR }, {
      runId: RUN, tenantId: TENANT, employeeId: UPS_EMP.id, employeeNo: UPS_EMP.no, basicMinor: 5_000_000n, month: MONTH,
      pensionScheme: "UPS", daRateBps: 5800n, cityClass: "X", taxRegime: "new", fyStartYear: 2026,
    });
  });
  app = await buildApp();
});

afterAll(async () => { await app.close(); await wipe(); await sqlClient.end(); });

describe("D6 / D5: wages used and employer charges are persisted with the slip", () => {
  it("slip pf_wage_minor is the capped Rs 15,000; the PF row has EPF/EDLI wages, EDLI Rs 75 and admin Rs 75", async () => {
    const rows = await asTenant((tx) => tx.execute(sql`
      SELECT s.pf_wage_minor::text AS slip_pf_wage, p.emp_contrib_minor::text AS ee, p.eps_contrib_minor::text AS eps,
             p.epf_er_contrib_minor::text AS epf_er, p.epf_wage_minor::text AS epf_wage, p.edli_wage_minor::text AS edli_wage,
             p.edli_contrib_minor::text AS edli, p.epf_admin_minor::text AS admin
      FROM payroll.payroll_slips s JOIN statutory.payroll_pf p ON p.slip_id = s.id
      WHERE s.tenant_id = ${TENANT}::uuid AND s.run_id = ${RUN}::uuid`)) as unknown as Array<Record<string, string>>;
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r).toEqual({ slip_pf_wage: "1500000", ee: "180000", eps: "125000", epf_er: "55000",
        epf_wage: "1500000", edli_wage: "1500000", edli: "7500", admin: "7500" });
    }
  });

  it("GET /statutory/pf/challan: A/c 1 = EE + EPF ER, A/c 2 raised to the Rs 500 minimum, A/c 10 EPS, A/c 21 EDLI, A/c 22 0", async () => {
    const r = await app.inject({ method: "GET", url: `/v1/payroll/statutory/pf/challan?period=${MONTH}`, headers: auth });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      period: MONTH, recordCount: 3, epfWagesMinor: "4500000", edliWagesMinor: "4500000", employeeShareMinor: "540000",
      accounts: { ac1EpfMinor: "705000", ac2AdminMinor: "50000", ac10EpsMinor: "375000", ac21EdliMinor: "22500", ac22EdliAdminMinor: "0" },
      // employer: EPF ER 1,650 + EPS 3,750 + admin 500 + EDLI 225 = Rs 6,125
      employerCostMinor: "612500",
      totalChallanMinor: "1152500",
    });
  });

  it("GET /statutory/pf/challan without a period is a 400", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/payroll/statutory/pf/challan", headers: auth });
    expect(r.statusCode).toBe(400);
  });
});

describe("UPS: the Government 8.5% pool share is its own statutory row, apart from the individual 10%", () => {
  it("payroll_nps carries employee 10% and Government individual 10%; payroll_ups_pool the 8.5% pool share", async () => {
    const nps = await asTenant((tx) => tx.execute(sql`SELECT emp_contrib_minor::text AS ee, er_contrib_minor::text AS er, er_contrib_pct::text AS pct, pension_base_minor::text AS base
      FROM statutory.payroll_nps WHERE tenant_id = ${TENANT}::uuid AND employee_id = ${UPS_EMP.id}::uuid`)) as unknown as Array<Record<string, string>>;
    expect(nps).toEqual([{ ee: "790000", er: "790000", pct: "10.00", base: "7900000" }]);
    const pool = await asTenant((tx) => tx.execute(sql`SELECT contrib_minor::text AS pool, contrib_pct::text AS pct, pension_base_minor::text AS base
      FROM statutory.payroll_ups_pool WHERE tenant_id = ${TENANT}::uuid AND employee_id = ${UPS_EMP.id}::uuid`)) as unknown as Array<Record<string, string>>;
    expect(pool).toEqual([{ pool: "671500", pct: "8.50", base: "7900000" }]); // 8.5% of Rs 79,000 = Rs 6,715
  });

  it("run totals for the GL accrual: EDLI, EPF admin and UPS pool, each on its own", async () => {
    expect(await asTenant((tx) => sumEmployerChargesByRunTx(tx as never, RUN, TENANT)))
      .toEqual({ edliMinor: 22_500n, epfAdminMinor: 22_500n, upsPoolMinor: 671_500n });
  });
});

describe("D3 / D4: ECR export", () => {
  it("refuses with 422 UAN_MISSING listing every member with a missing or invalid UAN", async () => {
    feed([null, "12345", "100200300400"]);
    const r = await app.inject({ method: "GET", url: `/v1/payroll/statutory/ecr?month=${MONTH}`, headers: auth });
    expect(r.statusCode).toBe(422);
    const body = r.json();
    expect(body.code).toBe("UAN_MISSING");
    expect(body.message).toContain("B18-EPF-1 (missing)");
    expect(body.message).toContain("B18-EPF-2 (invalid)");
    expect(body.message).not.toContain("B18-EPF-3");
    expect(body.employees).toHaveLength(2);
  });

  it("with valid UANs: an ECR 2.0 file, #~# separated, 11 fields, capped wages, no pipe", async () => {
    feed(["100200300401", "100200300402", "100200300403"]);
    const r = await app.inject({ method: "GET", url: `/v1/payroll/statutory/ecr?month=${MONTH}`, headers: auth });
    expect(r.statusCode).toBe(200);
    const lines = r.body.split("\r\n").sort();
    expect(lines).toHaveLength(3);
    expect(r.body).not.toContain("|");
    expect(lines[0]).toBe("100200300401#~#Contract Staff 1#~#33840#~#15000#~#15000#~#15000#~#1800#~#1250#~#550#~#0#~#0");
    for (const l of lines) expect(l.split("#~#")).toHaveLength(11);
  });
});

describe("D1: retro report for a back-dated scheme change (report only)", () => {
  it("lists the EPF slips when the scheme in effect is now NPS, without changing them", async () => {
    const before = await asTenant((tx) => tx.execute(sql`SELECT count(*)::int AS n FROM payroll.payroll_slips WHERE tenant_id = ${TENANT}::uuid`));
    const r = await app.inject({ method: "GET", url: `/v1/payroll/reports/pension-scheme-retro?employeeId=${EMP[0]!.id}&fromMonth=2027-01&toScheme=NPS`, headers: auth });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ postingPolicy: "report_only", affectedCount: 1,
      slips: [{ month: MONTH, computedScheme: "EPF", schemeInEffect: "NPS", differs: true, employeePensionDeductionMinor: "180000" }] });
    const none = await app.inject({ method: "GET", url: `/v1/payroll/reports/pension-scheme-retro?employeeId=${EMP[0]!.id}&fromMonth=2027-03&toScheme=NPS`, headers: auth });
    expect(none.json()).toMatchObject({ affectedCount: 0, slips: [] });
    const after = await asTenant((tx) => tx.execute(sql`SELECT count(*)::int AS n FROM payroll.payroll_slips WHERE tenant_id = ${TENANT}::uuid`));
    expect(after).toEqual(before);
  });
});

describe("D2: run creation is refused for an FY with no tax slab config", () => {
  const create = (month: string, runNo: string) => app.inject({ method: "POST", url: "/v1/payroll/runs", headers: auth,
    payload: { runNo, month, structureId: STRUCT, runType: "regular" } });
  const runCount = async (month: string) => ((await asTenant((tx) => tx.execute(sql`SELECT count(*)::int AS n FROM payroll.payroll_runs WHERE tenant_id = ${TENANT}::uuid AND month = ${month}`))) as unknown as Array<{ n: number }>)[0]!.n;

  const slabs = JSON.stringify([{ from: 0, to: null, rate: 0 }]);
  const addSlabs = (fy: number, regime: "new" | "old") => asTenant((tx) => tx.execute(sql`INSERT INTO payroll.tax_slab_config (tenant_id, fy_start_year, regime, slabs, std_deduction, rebate_income_cap, rebate_max, surcharge_bands, created_by)
    VALUES (${TENANT}::uuid, ${fy}, ${regime}, ${slabs}::jsonb, 75000, 1200000, 60000, ${"[]"}::jsonb, ${ACTOR}::uuid)`));

  it("FY 2027-28 with no new-regime slabs -> 422 TAX_CONFIG_MISSING with details, no run written", async () => {
    feed([null, null, null]);
    const r = await create("2027-08", "B18-TAX-1");
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("TAX_CONFIG_MISSING");
    expect(r.json().message).toContain("FY 2027-28");
    expect(r.json().details).toEqual({ fy: "2027-28", missingRegimes: ["new"] });
    expect(await runCount("2027-08")).toBe(0);
  });

  it("new-regime slabs only, and nobody on the old regime -> accepted (old slabs are optional)", async () => {
    await addSlabs(2027, "new");
    feed([null, null, null], ["new", "new", "new"]);
    const r = await create("2027-08", "B18-TAX-2");
    expect(r.statusCode).toBe(202);
    expect(await runCount("2027-08")).toBe(1);
  });

  it("new-regime slabs only, an employee opted for the old regime (HRMS) -> 422 naming them, with details", async () => {
    feed([null, null, null], ["new", "old", "new"]);
    const r = await create("2027-09", "B18-TAX-3");
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("TAX_CONFIG_MISSING");
    expect(r.json().message).toContain("B18-EPF-2");
    expect(r.json().details).toEqual({ fy: "2027-28", missingRegimes: ["old"], oldRegimeEmployees: [{ employeeId: EMP[1]!.id, employeeNo: "B18-EPF-2" }] });
    expect(await runCount("2027-09")).toBe(0);
  });

  it("the FY tax declaration decides the regime: declared old -> refused; declared new overrides HRMS old -> accepted", async () => {
    const declare = (empId: string, regime: string) => asTenant((tx) => tx.execute(sql`INSERT INTO payroll.payroll_tax_declarations (tenant_id, employee_id, fy, regime, created_by, updated_by)
      VALUES (${TENANT}::uuid, ${empId}::uuid, ${"2027-28"}, ${regime}, ${ACTOR}::uuid, ${ACTOR}::uuid)`));
    feed([null, null, null], ["new", "new", "old"]);
    await declare(EMP[0]!.id, "old");
    await declare(EMP[2]!.id, "new");
    const r1 = await create("2027-10", "B18-TAX-4");
    expect(r1.statusCode).toBe(422);
    expect(r1.json().details.oldRegimeEmployees).toEqual([{ employeeId: EMP[0]!.id, employeeNo: "B18-EPF-1" }]);
    await asTenant((tx) => tx.execute(sql`UPDATE payroll.payroll_tax_declarations SET regime = ${"new"} WHERE tenant_id = ${TENANT}::uuid AND employee_id = ${EMP[0]!.id}::uuid`));
    const r2 = await create("2027-10", "B18-TAX-5");
    expect(r2.statusCode).toBe(202);
  });

  it("with the old-regime slabs configured too, an old-regime employee is no obstacle", async () => {
    await addSlabs(2027, "old");
    feed([null, null, null], ["old", "old", "old"]);
    const r = await create("2027-11", "B18-TAX-6");
    expect(r.statusCode).toBe(202);
  });

  it("an FY with the platform default config (2026-27) passes the check", async () => {
    const r = await create("2026-11", "B18-TAX-7");
    expect(r.statusCode).toBe(202);
  });
});
