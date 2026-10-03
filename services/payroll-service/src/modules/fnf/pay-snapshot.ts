/**
 * GAP-PAYROLL-FNF-03: the pay-record-derived F&F inputs, computed from the
 * employee's own finalised payslips instead of trusting hand-typed numbers.
 *
 * Source: payroll.payroll_slips of APPROVED / DISBURSED REGULAR runs for
 * months up to and including the separation month (a failed or draft run, an
 * off-cycle run and a pensioner run are never pay history). Exception
 * (negative-net) and held slips are real computed pay and are included -- the
 * slip was computed, whether or not it was paid out.
 *
 *   lastDrawnWagesMinor        basic + DA of the latest month with a slip
 *   avgSalaryLast10MonthsMinor mean monthly basic + DA over (up to) the 10
 *                              latest months (Sec 10(10AA) "average salary":
 *                              basic + DA; commission is not modelled here)
 *   salaryYtdMinor             gross of every slip from 1 April of the FY the
 *                              separation falls in, to the separation month
 *   tdsYtdMinor                TDS deducted on those same slips
 *
 * VERIFY: "average salary" for leave encashment / gratuity is statutory
 * (Sec 10(10AA)(i): average salary of the 10 months preceding retirement);
 * CCS rules for government employees use "emoluments" (basic pay + NPA, DA
 * added separately). This default is basic + DA; a different definition is a
 * one-line change to wageOf().
 */
import { sql } from "drizzle-orm";

export type SlipMonth = { month: string; basicMinor: bigint; daMinor: bigint; grossMinor: bigint; tdsMinor: bigint };

export type PaySnapshot = {
  /** False when the employee has no finalised payslip up to the separation month (nothing to derive from). */
  available: boolean;
  fyStartYear: number;
  /** Months of pay history behind avgSalaryLast10Months (0..10). */
  wageMonths: number;
  /** Months of pay history behind the YTD figures. */
  ytdMonths: number;
  lastDrawnWagesMinor: string;
  avgSalaryLast10MonthsMinor: string;
  salaryYtdMinor: string;
  tdsYtdMinor: string;
};

/** Fields the server can derive and therefore holds the clerk to (an override needs a reason). */
export const PAY_DERIVED_FIELDS = ["lastDrawnWages", "avgSalaryLast10Months", "salaryYtd", "tdsYtd"] as const;
export type PayDerivedField = (typeof PAY_DERIVED_FIELDS)[number];

const wageOf = (m: SlipMonth): bigint => m.basicMinor + m.daMinor;

/** FY (1 Apr - 31 Mar) the date falls in, as its start year. */
export function fyStartYearOf(isoDate: string): number {
  const [y, m] = isoDate.split("-").map(Number) as [number, number];
  return m >= 4 ? y : y - 1;
}

/** Pure: monthly slip aggregates (any order, one row per month) -> snapshot. */
export function computePaySnapshot(months: SlipMonth[], separationDate: string): PaySnapshot {
  const sepMonth = separationDate.slice(0, 7);
  const fyStartYear = fyStartYearOf(separationDate);
  const upTo = months.filter((m) => m.month <= sepMonth).sort((a, b) => (a.month < b.month ? 1 : -1));
  if (upTo.length === 0) {
    return { available: false, fyStartYear, wageMonths: 0, ytdMonths: 0, lastDrawnWagesMinor: "0", avgSalaryLast10MonthsMinor: "0", salaryYtdMinor: "0", tdsYtdMinor: "0" };
  }
  const last10 = upTo.slice(0, 10);
  const wageSum = last10.reduce((s, m) => s + wageOf(m), 0n);
  const n = BigInt(last10.length);
  // Round half up in integer paise.
  const avg = (wageSum * 2n + n) / (2n * n);
  const ytd = upTo.filter((m) => m.month >= `${fyStartYear}-04`);
  return {
    available: true,
    fyStartYear,
    wageMonths: last10.length,
    ytdMonths: ytd.length,
    lastDrawnWagesMinor: wageOf(upTo[0]!).toString(),
    avgSalaryLast10MonthsMinor: avg.toString(),
    salaryYtdMinor: ytd.reduce((s, m) => s + m.grossMinor, 0n).toString(),
    tdsYtdMinor: ytd.reduce((s, m) => s + m.tdsMinor, 0n).toString(),
  };
}

type Executor = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

export async function loadPaySnapshot(tx: Executor, tenantId: string, employeeId: string, separationDate: string): Promise<PaySnapshot> {
  const sepMonth = separationDate.slice(0, 7);
  const rows = (await tx.execute(sql`
    SELECT r.month,
           COALESCE(SUM(s.basic_minor), 0)::text AS basic_minor,
           COALESCE(SUM(s.gross_minor), 0)::text AS gross_minor,
           COALESCE(SUM(s.tds_minor), 0)::text AS tds_minor,
           COALESCE(SUM((SELECT COALESCE(SUM((c->>'amountMinor')::bigint), 0)
                           FROM jsonb_array_elements(s.components) c
                          WHERE c->>'code' = 'DA')), 0)::text AS da_minor
      FROM payroll.payroll_slips s
      JOIN payroll.payroll_runs r ON r.id = s.run_id AND r.tenant_id = s.tenant_id
     WHERE s.tenant_id = ${tenantId}::uuid AND s.employee_id = ${employeeId}::uuid
       AND r.status IN ('approved', 'disbursed') AND r.run_type = 'regular'
       AND r.month <= ${sepMonth}
     GROUP BY r.month
  `)) as unknown as Array<{ month: string; basic_minor: string; gross_minor: string; tds_minor: string; da_minor: string }>;
  return computePaySnapshot(rows.map((r) => ({
    month: r.month, basicMinor: BigInt(r.basic_minor), daMinor: BigInt(r.da_minor), grossMinor: BigInt(r.gross_minor), tdsMinor: BigInt(r.tds_minor),
  })), separationDate);
}

/** Submitted compute inputs (paise bigint) that differ from what the pay records say. */
export function deviatingFields(
  snap: PaySnapshot,
  submitted: { lastDrawnWagesMinor: bigint; avgSalaryLast10MonthsMinor: bigint; salaryYtdMinor: bigint; tdsYtdMinor: bigint },
): PayDerivedField[] {
  if (!snap?.available) return [];
  const out: PayDerivedField[] = [];
  if (submitted.lastDrawnWagesMinor !== BigInt(snap.lastDrawnWagesMinor)) out.push("lastDrawnWages");
  if (submitted.avgSalaryLast10MonthsMinor !== BigInt(snap.avgSalaryLast10MonthsMinor)) out.push("avgSalaryLast10Months");
  if (submitted.salaryYtdMinor !== BigInt(snap.salaryYtdMinor)) out.push("salaryYtd");
  if (submitted.tdsYtdMinor !== BigInt(snap.tdsYtdMinor)) out.push("tdsYtd");
  return out;
}
