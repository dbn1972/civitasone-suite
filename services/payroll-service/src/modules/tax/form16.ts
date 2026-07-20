import { eq, and, inArray } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { payrollSlips, payrollRuns } from "../payroll/schema.js";
import { payrollTds } from "../statutory/schema.js";
import { taxDeclarations } from "./schema.js";
import { computeTax } from "./engine.js";
import { fetchPayrollInput } from "../../shared/hrms-client.js";

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
 * Build a Form 16 (Part A identity + quarterly TDS, Part B full computation)
 * for an employee and FY. Single source of truth for both the JSON API and PDF.
 */
export async function buildForm16(tenantId: string, employeeId: string, fy: string): Promise<Form16> {
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
  const grossSalary = Math.round(fySlips.reduce((a, s) => a + Number(s.grossMinor) / 100, 0));

  // Quarterly TDS breakup.
  const quarters = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
  const quarterOf = (period: string): keyof typeof quarters => {
    const m = Number(period.slice(5, 7));
    if (m >= 4 && m <= 6) return "Q1";
    if (m >= 7 && m <= 9) return "Q2";
    if (m >= 10 && m <= 12) return "Q3";
    return "Q4";
  };
  let totalTdsDeducted = 0;
  for (const month of months) {
    const tdsRows = await scopedRead((tx) => tx.select().from(payrollTds)
      .where(and(eq(payrollTds.tenantId, tenantId), eq(payrollTds.employeeId, employeeId), eq(payrollTds.period, month))));
    for (const t of tdsRows) {
      // M3: exclude TDS rows whose source run is not approved/disbursed.
      if (!finalisedRunIds.has(t.runId)) continue;
      const amt = Number(t.tdsMinor) / 100;
      totalTdsDeducted += amt;
      quarters[quarterOf(month)] += amt;
    }
  }

  const decRows = await scopedRead((tx) => tx.select().from(taxDeclarations)
    .where(and(eq(taxDeclarations.tenantId, tenantId), eq(taxDeclarations.employeeId, employeeId), eq(taxDeclarations.fy, fy)))
    .limit(1));
  const dec = decRows[0] ?? null;
  const regime = (dec?.regime ?? "new") as "old" | "new";

  const standardDeduction = regime === "new" ? 75000 : 50000;
  const section80c = regime === "old" && dec ? Math.min(Number(dec.section80c) / 100, 150000) : 0;
  const section80d = regime === "old" && dec ? Math.min(Number(dec.section80d) / 100, 50000) : 0;
  const hraExempt = regime === "old" && dec ? Number(dec.hraClaimed) / 100 : 0;
  const otherDeductions = regime === "old" && dec ? Number(dec.otherDeductions) / 100 : 0;
  const totalChapterViA = section80c + section80d + otherDeductions;

  // Additions taxed under both regimes (Sec 17(2) perquisites, prev-employer
  // salary Sec 192(2), income from other sources).
  const perquisites        = dec ? Number(dec.perquisitesMinor) / 100 : 0;
  const prevEmployerSalary = dec ? Number(dec.prevEmployerSalaryMinor) / 100 : 0;
  const otherSourcesIncome = dec ? Number(dec.otherSourcesIncomeMinor) / 100 : 0;
  const prevEmployerTds    = dec ? Number(dec.prevEmployerTdsMinor) / 100 : 0;
  const extraIncome        = perquisites + prevEmployerSalary + otherSourcesIncome;

  const taxableIncome = Math.max(0, Math.round((grossSalary + extraIncome - standardDeduction - hraExempt - totalChapterViA) / 10) * 10);
  const tax = computeTax(taxableIncome, regime, startYear);
  const totalTaxLiability = tax.totalTax;
  // Total TDS credited = deducted by this employer + reported prev-employer TDS.
  const totalTdsCredited = Math.round(totalTdsDeducted) + Math.round(prevEmployerTds);
  const balance = Math.round(totalTaxLiability - totalTdsCredited);

  // M4: HRMS fetch failure must FAIL the export (HrmsUnavailableError propagates
  // → 502) instead of silently emitting a blank PAN. A blank PAN is only
  // legitimate when the employee is reachable but genuinely has no PAN on file.
  const input = await fetchPayrollInput(tenantId, `${endYear}-03`);
  const emp = input.employees.find((e) => e.id === employeeId);
  const deducteePan = emp?.pan ?? "";   // reachable + no PAN → genuine PANNOTAVBL
  const deducteeName = emp?.fullName ?? "";

  return {
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
      totalTdsDeposited: Math.round(totalTdsDeducted),
      note: "Verify challan/TRACES references before issuing Part A.",
    },
    form16PartB: {
      grossSalary, perquisites, prevEmployerSalary, otherSourcesIncome,
      standardDeduction, hraExempt, section80c, section80d, otherDeductions, totalChapterViA,
      taxableIncome, taxOnIncome: tax.baseTax, rebate87A: tax.rebate, surcharge: tax.surcharge, cess: tax.cess,
      totalTaxLiability, totalTdsDeducted: Math.round(totalTdsDeducted), prevEmployerTds: Math.round(prevEmployerTds),
      balanceTaxPayable: balance > 0 ? balance : 0, refundDue: balance < 0 ? -balance : 0, regime,
    },
  };
}
