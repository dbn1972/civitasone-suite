import { toSafeInt, minorToRupees } from "../../shared/money.js";
import { eq, and, inArray } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { payrollSlips, payrollRuns } from "../payroll/schema.js";
import { payrollTds } from "../statutory/schema.js";
import { taxDeclarations } from "./schema.js";
import { computeTax, roundRupeeMinor, roundTenRupeesMinor } from "./engine.js";
import { fetchPayrollInput } from "../../shared/hrms-client.js";
import { resolveVerificationPlan, applyPlanToRowExact, istToday } from "./verified-inputs.js";
import { computeHraClaimedMinor } from "./consumer.js";
import { resolveRunStatutoryConfig } from "../payroll/consumer.js";

/**
 * Parse "2025-26" → start/end year. Throws on malformed input.
 * M5: strict validation — must match ^\d{4}-\d{2}$ AND the two-digit suffix must
 * equal (startYear+1)%100 (e.g. 2025-26 valid; 2025-99 / 2025-XYZ rejected 400).
 */
export function parseFy(fy: string): { startYear: number; endYear: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(fy ?? "");
  if (!m) throw new Error("fy must be in format YYYY-YY e.g. 2025-26");
  const startYear = parseInt(m[1]!, 10);
  const suffix = parseInt(m[2]!, 10);
  if (suffix !== (startYear + 1) % 100) {
    throw new Error("fy second component must be (startYear+1) mod 100, e.g. 2025-26");
  }
  return { startYear, endYear: startYear + 1 };
}

/** The 12 Apr–Mar months (YYYY-MM) of a financial year. */
export function fyMonths(startYear: number): string[] {
  const months: string[] = [];
  for (let m = 4; m <= 12; m++) months.push(`${startYear}-${String(m).padStart(2, "0")}`);
  for (let m = 1; m <= 3; m++) months.push(`${startYear + 1}-${String(m).padStart(2, "0")}`);
  return months;
}

export interface Form16 {
  employeeId: string;
  fy: string;
  assessmentYear: string;
  form16PartA: {
    deductor: { name: string; tan: string; pan: string };
    deductee: { name: string; pan: string; panFlag: string };
    quarterlyTds: { Q1: number; Q2: number; Q3: number; Q4: number };
    totalTdsDeposited: number;
    note: string;
  };
  form16PartB: {
    grossSalary: number; perquisites: number; prevEmployerSalary: number; otherSourcesIncome: number;
    standardDeduction: number; hraExempt: number;
    section80c: number; section80d: number; otherDeductions: number; totalChapterViA: number;
    taxableIncome: number; taxOnIncome: number; rebate87A: number; surcharge: number; cess: number;
    totalTaxLiability: number; totalTdsDeducted: number; prevEmployerTds: number;
    balanceTaxPayable: number; refundDue: number; regime: "old" | "new";
  };
}

/**
 * GAP-PAYROLL-RETURNS-06: Form 16 Part B in EXACT integer paise. buildForm16()
 * accumulates every figure as bigint paise anyway and then divides once into the
 * display-rupee `form16PartB` above; this is the same set of figures before that
 * division, so a consumer that needs paise (the 24Q Annexure II wire) never has
 * to multiply a rupee Number back up by 100. Field-for-field twin of
 * `Form16["form16PartB"]`: every `xMinor` is that field's value in paise.
 */
export interface Form16PartBMinor {
  grossSalaryMinor: bigint; perquisitesMinor: bigint; prevEmployerSalaryMinor: bigint; otherSourcesIncomeMinor: bigint;
  standardDeductionMinor: bigint; hraExemptMinor: bigint;
  section80cMinor: bigint; section80dMinor: bigint; otherDeductionsMinor: bigint; totalChapterViAMinor: bigint;
  taxableIncomeMinor: bigint; taxOnIncomeMinor: bigint; rebate87AMinor: bigint; surchargeMinor: bigint; cessMinor: bigint;
  totalTaxLiabilityMinor: bigint; totalTdsDeductedMinor: bigint; prevEmployerTdsMinor: bigint;
  balanceTaxPayableMinor: bigint; refundDueMinor: bigint;
  regime: "old" | "new";
}

export interface Form16WithMinor {
  form16: Form16;
  partBMinor: Form16PartBMinor;
}

/**
 * A whole-rupee amount (the tax engine reports slab tax, rebate, surcharge, cess
 * and total tax as whole rupees -- Sec 288B -- derived from bigint paise) as
 * exact paise. Integer-only arithmetic; a fractional rupee is a bug upstream and
 * fails loudly instead of being rounded here.
 */
function wholeRupeesToMinor(rupees: number): bigint {
  if (!Number.isInteger(rupees)) throw new Error(`Form 16 expected a whole-rupee amount, got ${rupees}`);
  return BigInt(rupees) * 100n;
}

const CAP_80C_MINOR = 15_000_000n; // Rs 150,000
const CAP_80D_MINOR = 5_000_000n;  // Rs 50,000
const minBig = (a: bigint, b: bigint): bigint => (a < b ? a : b);
const maxBig = (a: bigint, b: bigint): bigint => (a > b ? a : b);

export interface Form16DeductionInputs {
  grossMinor: bigint;
  standardDeduction: number; // rupees
  hraClaimedMinor: bigint;
  section80cMinor: bigint;   // pre-cap, as declared
  section80dMinor: bigint;   // pre-cap, as declared
  otherDeductionsMinor: bigint;
  perquisitesMinor: bigint;
  prevEmployerSalaryMinor: bigint;
  otherSourcesIncomeMinor: bigint;
  regime: "old" | "new";
}

/**
 * Pure Chapter VI-A + taxable-income computation for Form 16 Part B — extracted
 * out of `buildForm16` (which is DB-bound) so DOM-014's bigint arithmetic can be
 * unit-tested directly. Everything here is bigint paise end-to-end: the caps
 * (80C/80D), the Chapter VI-A total, and the final Sec 288A round-to-nearest-10
 * are all exact integer operations — no float division of a converted paise
 * value happens until the very last line, once, on an amount that is already whole-rupee.
 *
 * Declared amounts (`section80cMinor` etc.) are arbitrary non-negative integer
 * paise (see `amountMinor` in validators.ts) — NOT guaranteed whole-rupee — so
 * summing them as float rupees before rounding to the nearest 10
 * rupees (as the pre-DOM-014 code did) could round to the wrong bracket; see
 * `dom-014-tax-precision.test.ts` for a concrete reproduction.
 */
export function computeForm16Deductions(
  inputs: Form16DeductionInputs,
  // DOM-025: tenant-resolved Sec 80D cap (domain.ts's config-driven
  // sec80dCapMinor, DOM-008). Defaults to this file's own historical
  // CAP_80D_MINOR so existing callers/tests exercising DOM-014's
  // bigint-precision behavior (orthogonal to the 80D cap source) are
  // unaffected; buildForm16 below passes the resolved tenant value.
  sec80dCapMinor: bigint = CAP_80D_MINOR,
  // DOM-030: same treatment for the sibling Sec 80C cap (domain.ts's
  // config-driven sec80cCapMinor, DOM-008), mirroring DOM-025's fix for
  // 80D in this exact function. Defaults to this file's own historical
  // CAP_80C_MINOR so dom-014-tax-precision.test.ts's existing calls
  // (which pass only `inputs`) are unaffected; buildForm16 below passes
  // the resolved tenant value.
  sec80cCapMinor: bigint = CAP_80C_MINOR,
) {
  const isOld = inputs.regime === "old";
  const section80cMinor = isOld ? minBig(inputs.section80cMinor, sec80cCapMinor) : 0n;
  const section80dMinor = isOld ? minBig(inputs.section80dMinor, sec80dCapMinor) : 0n;
  const hraExemptMinor = isOld ? inputs.hraClaimedMinor : 0n;
  const otherDeductionsMinor = isOld ? inputs.otherDeductionsMinor : 0n;
  const totalChapterViAMinor = section80cMinor + section80dMinor + otherDeductionsMinor;

  const extraIncomeMinor = inputs.perquisitesMinor + inputs.prevEmployerSalaryMinor + inputs.otherSourcesIncomeMinor;
  const standardDeductionMinor = BigInt(inputs.standardDeduction) * 100n;

  const taxableIncomeMinor = roundTenRupeesMinor(maxBig(0n,
    inputs.grossMinor + extraIncomeMinor - standardDeductionMinor - hraExemptMinor - totalChapterViAMinor));

  return {
    section80cMinor, section80dMinor, hraExemptMinor, otherDeductionsMinor, totalChapterViAMinor,
    extraIncomeMinor, taxableIncomeMinor, taxableIncome: toSafeInt(taxableIncomeMinor / 100n),
  };
}

/**
 * Build a Form 16 (Part A identity + quarterly TDS, Part B full computation)
 * for an employee and FY. Single source of truth for both the JSON API and PDF.
 *
 * DOM-014: every amount below is accumulated as bigint paise (`*Minor`) and
 * converted to the Number-rupee report fields with a single division at the
 * very end — never float rupees summed or subtracted repeatedly across
 * many slip/TDS rows and declaration fields (declared amounts are arbitrary
 * paise, not necessarily whole-rupee, per `amountMinor` in validators.ts), so
 * no float-precision error can accumulate into the taxable-income / tax-due
 * figures. Fields that were previously `Math.round(...)`-ed individually
 * (totalTdsDeposited, prevEmployerTds, totalTdsDeducted) still round via the
 * bigint `roundRupeeMinor` in the same order as before, so displayed values
 * are unchanged for all pre-existing (whole-rupee) data.
 */
export async function buildForm16(tenantId: string, employeeId: string, fy: string): Promise<Form16> {
  return (await buildForm16WithMinor(tenantId, employeeId, fy)).form16;
}

/**
 * Same computation as {@link buildForm16}, returning the exact-paise Part B
 * alongside the display-rupee Form 16. Both are views of ONE computation, so
 * they cannot drift: `partBMinor.xMinor / 100` is `form16.form16PartB.x`.
 */
export async function buildForm16WithMinor(tenantId: string, employeeId: string, fy: string): Promise<Form16WithMinor> {
  const { startYear, endYear } = parseFy(fy);
  const months = fyMonths(startYear);

  // M3: only count figures from runs that have actually been finalised
  // (approved/disbursed). A draft/processing/failed run must not contribute to
  // Form 16 gross or TDS — an out-of-order or abandoned run would otherwise
  // corrupt the Sec-192 true-up.
  const fyRuns = await scopedRead((tx) => tx.select().from(payrollRuns)
    .where(and(eq(payrollRuns.tenantId, tenantId), inArray(payrollRuns.month, months))));
  const finalisedRunIds = new Set(
    fyRuns.filter((r) => r.status === "approved" || r.status === "disbursed").map((r) => r.id),
  );
  const slipRows = await scopedRead((tx) => tx.select().from(payrollSlips)
    .where(and(eq(payrollSlips.tenantId, tenantId), eq(payrollSlips.employeeId, employeeId))));
  const fySlips = slipRows.filter((s) => finalisedRunIds.has(s.runId));
  const grossMinor = roundRupeeMinor(fySlips.reduce((a, s) => a + BigInt(s.grossMinor), 0n));
  const grossSalary = toSafeInt(grossMinor / 100n);

  // Quarterly TDS breakup.
  const quartersMinor = { Q1: 0n, Q2: 0n, Q3: 0n, Q4: 0n };
  const quarterOf = (period: string): keyof typeof quartersMinor => {
    const m = Number(period.slice(5, 7));
    if (m >= 4 && m <= 6) return "Q1";
    if (m >= 7 && m <= 9) return "Q2";
    if (m >= 10 && m <= 12) return "Q3";
    return "Q4";
  };
  let totalTdsMinor = 0n;
  for (const month of months) {
    const tdsRows = await scopedRead((tx) => tx.select().from(payrollTds)
      .where(and(eq(payrollTds.tenantId, tenantId), eq(payrollTds.employeeId, employeeId), eq(payrollTds.period, month))));
    for (const t of tdsRows) {
      // M3: exclude TDS rows whose source run is not approved/disbursed.
      if (!finalisedRunIds.has(t.runId)) continue;
      const amtMinor = BigInt(t.tdsMinor);
      totalTdsMinor += amtMinor;
      quartersMinor[quarterOf(month)] += amtMinor;
    }
  }
  const quarters = {
    Q1: minorToRupees(quartersMinor.Q1), Q2: minorToRupees(quartersMinor.Q2),
    Q3: minorToRupees(quartersMinor.Q3), Q4: minorToRupees(quartersMinor.Q4),
  };
  const totalTdsDeductedMinor = roundRupeeMinor(totalTdsMinor);

  const decRows = await scopedRead((tx) => tx.select().from(taxDeclarations)
    .where(and(eq(taxDeclarations.tenantId, tenantId), eq(taxDeclarations.employeeId, employeeId), eq(taxDeclarations.fy, fy)))
    .limit(1));
  // GAP-PAYROLL-TAX-DECLARATION-02: after the tenant's proof cutoff only verified amounts count.
  const proofPlan = await scopedRead((tx) => resolveVerificationPlan(tx, tenantId, fy, istToday(), [employeeId]));
  const dec = decRows[0]
    ? await applyPlanToRowExact(proofPlan, decRows[0], (emp, rent) => scopedRead((tx) =>
        computeHraClaimedMinor(tx as unknown as Parameters<typeof computeHraClaimedMinor>[0], tenantId, emp, "old", fy, rent)))
    : null;
  const regime = (dec?.regime ?? "new") as "old" | "new";

  const standardDeduction = regime === "new" ? 75000 : 50000;
  // Additions taxed under both regimes (Sec 17(2) perquisites, prev-employer
  // salary Sec 192(2), income from other sources).
  const perquisitesMinor        = dec ? BigInt(dec.perquisitesMinor) : 0n;
  const prevEmployerSalaryMinor = dec ? BigInt(dec.prevEmployerSalaryMinor) : 0n;
  const otherSourcesIncomeMinor = dec ? BigInt(dec.otherSourcesIncomeMinor) : 0n;
  const prevEmployerTdsMinor    = dec ? BigInt(dec.prevEmployerTdsMinor) : 0n;

  // DOM-025/DOM-030: this function used to apply computeForm16Deductions'
  // own internal CAP_80D_MINOR/CAP_80C_MINOR (Rs 50,000 / Rs 1,50,000)
  // unconditionally, disagreeing with domain.ts's config-driven
  // sec80dCapMinor/sec80cCapMinor (DOM-008's platform defaults Rs 75,000 /
  // Rs 1,50,000) and silently ignoring a tenant's override -- same bug
  // class DOM-020 fixed in tax/routes.ts. DOM-025 fixed the 80D cap first;
  // DOM-030 destructures the sibling sec80cCapMinor field from this SAME
  // already-fetched config object -- zero extra DB round-trips, exactly
  // mirroring DOM-026's fix in gap-routes.ts. Resolve the same
  // effective-dated config through scopedRead(), FY-scoped as of the
  // FY's last month (endYear-03), matching this function's own
  // fetchPayrollInput call below and DOM-020's tax/routes.ts convention.
  const { sec80cCapMinor, sec80dCapMinor } = await scopedRead((tx) => resolveRunStatutoryConfig(tx, tenantId, `${endYear}-03`));

  const {
    section80cMinor, section80dMinor, hraExemptMinor, otherDeductionsMinor, totalChapterViAMinor,
    taxableIncome, taxableIncomeMinor,
  } = computeForm16Deductions({
    grossMinor, standardDeduction, regime,
    hraClaimedMinor: dec ? BigInt(dec.hraClaimed) : 0n,
    section80cMinor: dec ? BigInt(dec.section80c) : 0n,
    section80dMinor: dec ? BigInt(dec.section80d) : 0n,
    otherDeductionsMinor: dec ? BigInt(dec.otherDeductions) : 0n,
    perquisitesMinor, prevEmployerSalaryMinor, otherSourcesIncomeMinor,
  }, sec80dCapMinor, sec80cCapMinor);
  // DOM-008 (completing #1117): resolved for this employee's own tenant.
  const tax = computeTax(taxableIncome, regime, startYear, tenantId);
  const totalTaxLiability = tax.totalTax;
  // Total TDS credited = deducted by this employer + reported prev-employer TDS
  // (each rounded to the nearest whole rupee individually before summing, same
  // order as the pre-DOM-014 Math.round(a) + Math.round(b)).
  const prevEmployerTdsRoundedMinor = roundRupeeMinor(prevEmployerTdsMinor);
  const totalTdsCreditedMinor = totalTdsDeductedMinor + prevEmployerTdsRoundedMinor;
  const totalTaxLiabilityMinor = BigInt(totalTaxLiability) * 100n;
  const balanceMinor = totalTaxLiabilityMinor - totalTdsCreditedMinor;
  const balance = toSafeInt(balanceMinor / 100n);

  // M4: HRMS fetch failure must FAIL the export (HrmsUnavailableError propagates
  // → 502) instead of silently emitting a blank PAN. A blank PAN is only
  // legitimate when the employee is reachable but genuinely has no PAN on file.
  const input = await fetchPayrollInput(tenantId, `${endYear}-03`);
  const emp = input.employees.find((e) => e.id === employeeId);
  const deducteePan = emp?.pan ?? "";   // reachable + no PAN → genuine PANNOTAVBL
  const deducteeName = emp?.fullName ?? "";

  const form16: Form16 = {
    employeeId,
    fy,
    assessmentYear: `${endYear}-${String((endYear + 1) % 100).padStart(2, "0")}`,
    form16PartA: {
      deductor: {
        name: process.env.EMPLOYER_NAME ?? "<EMPLOYER NAME — configure EMPLOYER_NAME>",
        tan: process.env.EMPLOYER_TAN ?? "<TAN — configure EMPLOYER_TAN>",
        pan: process.env.EMPLOYER_PAN ?? "<PAN — configure EMPLOYER_PAN>",
      },
      deductee: { name: deducteeName, pan: deducteePan, panFlag: deducteePan ? "" : "PANNOTAVBL" },
      quarterlyTds: quarters,
      totalTdsDeposited: toSafeInt(totalTdsDeductedMinor / 100n),
      note: "Verify challan/TRACES references before issuing Part A.",
    },
    form16PartB: {
      grossSalary,
      perquisites: minorToRupees(perquisitesMinor),
      prevEmployerSalary: minorToRupees(prevEmployerSalaryMinor),
      otherSourcesIncome: minorToRupees(otherSourcesIncomeMinor),
      standardDeduction,
      hraExempt: minorToRupees(hraExemptMinor),
      section80c: minorToRupees(section80cMinor),
      section80d: minorToRupees(section80dMinor),
      otherDeductions: minorToRupees(otherDeductionsMinor),
      totalChapterViA: minorToRupees(totalChapterViAMinor),
      taxableIncome, taxOnIncome: tax.baseTax, rebate87A: tax.rebate, surcharge: tax.surcharge, cess: tax.cess,
      totalTaxLiability,
      totalTdsDeducted: toSafeInt(totalTdsDeductedMinor / 100n),
      prevEmployerTds: toSafeInt(prevEmployerTdsRoundedMinor / 100n),
      balanceTaxPayable: balance > 0 ? balance : 0, refundDue: balance < 0 ? -balance : 0, regime,
    },
  };

  const partBMinor: Form16PartBMinor = {
    grossSalaryMinor: grossMinor,
    perquisitesMinor,
    prevEmployerSalaryMinor,
    otherSourcesIncomeMinor,
    standardDeductionMinor: wholeRupeesToMinor(standardDeduction),
    hraExemptMinor,
    section80cMinor,
    section80dMinor,
    otherDeductionsMinor,
    totalChapterViAMinor,
    taxableIncomeMinor,
    taxOnIncomeMinor: wholeRupeesToMinor(tax.baseTax),
    rebate87AMinor: wholeRupeesToMinor(tax.rebate),
    surchargeMinor: wholeRupeesToMinor(tax.surcharge),
    cessMinor: wholeRupeesToMinor(tax.cess),
    totalTaxLiabilityMinor,
    totalTdsDeductedMinor,
    prevEmployerTdsMinor: prevEmployerTdsRoundedMinor,
    balanceTaxPayableMinor: balanceMinor > 0n ? balanceMinor : 0n,
    refundDueMinor: balanceMinor < 0n ? -balanceMinor : 0n,
    regime,
  };

  return { form16, partBMinor };
}
