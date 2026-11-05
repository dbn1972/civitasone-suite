/**
 * UAT P3 b19 D-10: the employee-deduction split carried on payroll.run.approved
 * (employeeDeductionsMinor), so finance can book TDS, GPF, NPS, EPF, ESI and PT
 * to their own payable heads instead of one lump of (gross - net).
 *
 * tds / gpf / nps / pf / esi are the EMPLOYEE shares in the statutory ledgers
 * (statutory/repo.ts sumEmployeeStatutoryByRunTx), pt is the slips PT lines,
 * and other is the remainder (gross - net - the six): LIC, society, loan and
 * any other recoveries. The parts therefore always sum EXACTLY to gross - net.
 * A negative remainder (the ledgers disagree with the slips) is still put in
 * other so the sum stays exact, and is flagged so the caller warns and audits.
 */
import { minorFromDb } from "../../shared/money.js";

export const EMPLOYEE_DEDUCTION_KEYS = ["tds", "gpf", "nps", "pf", "esi", "pt", "other"] as const;
export type EmployeeDeductionKey = (typeof EMPLOYEE_DEDUCTION_KEYS)[number];
/** Paise as base-10 integer strings (the wire form of every other *Minor on this event). */
export type EmployeeDeductionsMinor = Record<EmployeeDeductionKey, string>;

export interface EmployeeDeductionInputs {
  grossMinor: bigint; netMinor: bigint;
  tdsMinor: bigint; gpfMinor: bigint; npsMinor: bigint; pfMinor: bigint; esiMinor: bigint; ptMinor: bigint;
}

export function splitEmployeeDeductions(i: EmployeeDeductionInputs): { parts: EmployeeDeductionsMinor; negativeOther: boolean } {
  const named = i.tdsMinor + i.gpfMinor + i.npsMinor + i.pfMinor + i.esiMinor + i.ptMinor;
  const other = (i.grossMinor - i.netMinor) - named;
  return {
    parts: {
      tds: i.tdsMinor.toString(), gpf: i.gpfMinor.toString(), nps: i.npsMinor.toString(),
      pf: i.pfMinor.toString(), esi: i.esiMinor.toString(), pt: i.ptMinor.toString(), other: other.toString(),
    },
    negativeOther: other < 0n,
  };
}

const PT_CODE = "PT";

/** Professional tax deducted on the given slips (their "PT" deduction lines), in paise. */
export function ptOfSlips(slips: ReadonlyArray<{ components: ReadonlyArray<{ code: string; type: string; amountMinor: unknown }> | null }>): bigint {
  let pt = 0n;
  for (const s of slips) {
    for (const c of s.components ?? []) {
      if (c.code === PT_CODE && c.type === "deduction") pt += minorFromDb(c.amountMinor);
    }
  }
  return pt;
}
