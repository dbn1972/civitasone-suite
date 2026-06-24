import { eq, and, inArray } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { payrollSlips, payrollRuns } from "../payroll/schema.js";
import { payrollTds } from "../statutory/schema.js";
import { taxDeclarations } from "./schema.js";
import { computeTax } from "./engine.js";
import { fetchPayrollInput } from "../../shared/hrms-client.js";

/** Parse "2025-26" → start/end year. Throws on malformed input. */
export function parseFy(fy: string): { startYear: number; endYear: number } {
  const parts = fy.split("-");
  const startYear = parts[0] ? parseInt(parts[0], 10) : NaN;
  if (parts.length !== 2 || Number.isNaN(startYear)) {
    throw new Error("fy must be in format YYYY-YY e.g. 2025-26");
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
    deductee: { name: string; pan: string };
    quarterlyTds: { Q1: number; Q2: number; Q3: number; Q4: number };
    totalTdsDeposited: number;
    note: string;
  };
  form16PartB: {
    grossSalary: number; standardDeduction: number; hraExempt: number;
    section80c: number; section80d: number; otherDeductions: number; totalChapterViA: number;
    taxableIncome: number; taxOnIncome: number; rebate87A: number; surcharge: number; cess: number;
    totalTaxLiability: number; totalTdsDeducted: number;
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

  // Actual gross paid = sum of monthly slip gross for FY runs.
  const fyRuns = await db.select().from(payrollRuns)
    .where(and(eq(payrollRuns.tenantId, tenantId), inArray(payrollRuns.month, months)));
  const fyRunIds = new Set(fyRuns.map((r) => r.id));
  const slipRows = await db.select().from(payrollSlips)
    .where(and(eq(payrollSlips.tenantId, tenantId), eq(payrollSlips.employeeId, employeeId)));
  const fySlips = slipRows.filter((s) => fyRunIds.has(s.runId));
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
    const tdsRows = await db.select().from(payrollTds)
      .where(and(eq(payrollTds.tenantId, tenantId), eq(payrollTds.employeeId, employeeId), eq(payrollTds.period, month)));
    for (const t of tdsRows) {
      const amt = Number(t.tdsMinor) / 100;
      totalTdsDeducted += amt;
      quarters[quarterOf(month)] += amt;
    }
  }

  const decRows = await db.select().from(taxDeclarations)
    .where(and(eq(taxDeclarations.tenantId, tenantId), eq(taxDeclarations.employeeId, employeeId), eq(taxDeclarations.fy, fy)))
    .limit(1);
  const dec = decRows[0] ?? null;
  const regime = (dec?.regime ?? "new") as "old" | "new";

  const standardDeduction = regime === "new" ? 75000 : 50000;
  const section80c = regime === "old" && dec ? Math.min(Number(dec.section80c) / 100, 150000) : 0;
  const section80d = regime === "old" && dec ? Math.min(Number(dec.section80d) / 100, 50000) : 0;
  const hraExempt = regime === "old" && dec ? Number(dec.hraClaimed) / 100 : 0;
  const otherDeductions = regime === "old" && dec ? Number(dec.otherDeductions) / 100 : 0;
  const totalChapterViA = section80c + section80d + otherDeductions;

  const taxableIncome = Math.max(0, Math.round((grossSalary - standardDeduction - hraExempt - totalChapterViA) / 10) * 10);
  const tax = computeTax(taxableIncome, regime, startYear);
  const totalTaxLiability = tax.totalTax;
  const balance = Math.round(totalTaxLiability - totalTdsDeducted);

  let deducteePan = ""; let deducteeName = "";
  try {
    const input = await fetchPayrollInput(tenantId, `${endYear}-03`);
    const emp = input.employees.find((e) => e.id === employeeId);
    deducteePan = emp?.pan ?? "";
    deducteeName = emp?.fullName ?? "";
  } catch { /* HRMS unavailable — identity blank, computation still valid */ }

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
      deductee: { name: deducteeName, pan: deducteePan },
      quarterlyTds: quarters,
      totalTdsDeposited: Math.round(totalTdsDeducted),
      note: "Verify challan/TRACES references before issuing Part A.",
    },
    form16PartB: {
      grossSalary, standardDeduction, hraExempt, section80c, section80d, otherDeductions, totalChapterViA,
      taxableIncome, taxOnIncome: tax.baseTax, rebate87A: tax.rebate, surcharge: tax.surcharge, cess: tax.cess,
      totalTaxLiability, totalTdsDeducted: Math.round(totalTdsDeducted),
      balanceTaxPayable: balance > 0 ? balance : 0, refundDue: balance < 0 ? -balance : 0, regime,
    },
  };
}
