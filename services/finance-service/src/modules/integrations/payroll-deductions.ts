import { and, eq, inArray } from "drizzle-orm";
import { financeHeads } from "../budget/schema.js";
import { payrollDeductionHeads } from "../gl/system-heads.js";

// UAT T-PERIOD D-10 helpers (b19-fin), shared by the approval path
// (integrations/consumer.ts) and the cash-basis accrual on disbursal (gl/consumer.ts).

export type DeductionKind = "tds" | "gpf" | "nps" | "pf" | "esi" | "pt" | "other";
const DEDUCTION_ORDER: DeductionKind[] = ["tds", "gpf", "nps", "pf", "esi", "pt", "other"];
const DEDUCTION_NARRATION: Record<DeductionKind, string> = {
  tds: "Income tax deducted at source (salary) payable", gpf: "GPF subscriptions payable", nps: "NPS employee contributions payable",
  pf: "EPF employee contributions payable", esi: "ESI employee contributions payable", pt: "Professional tax payable",
  other: "Other salary deductions payable (LIC / others)",
};

/**
 * UAT T-PERIOD D-10: the employee-side deduction legs of the salary accrual. With a breakdown whose parts sum exactly
 * to `statutory` (gross - net), one credit per non-zero part on its configured head (gl/system-heads.ts
 * payrollDeductionHeads; a negative part is booked on the debit side so the voucher still balances). Without a
 * breakdown, or when the parts do not add up, the whole amount stays one 2102 leg (the pre-b19 behaviour).
 */
export function deductionLines(
  statutory: bigint, breakdown: Partial<Record<DeductionKind, string>> | undefined,
): Array<{ accountCode: string; debitMinor: bigint; creditMinor: bigint; narration: string }> {
  const heads = payrollDeductionHeads();
  const leg = (code: string, v: bigint, narration: string) =>
    v >= 0n ? { accountCode: code, debitMinor: 0n, creditMinor: v, narration } : { accountCode: code, debitMinor: -v, creditMinor: 0n, narration };
  if (breakdown) {
    const parts = DEDUCTION_ORDER.map((k) => [k, BigInt(breakdown[k] ?? "0")] as const);
    if (parts.reduce((acc, [, v]) => acc + v, 0n) === statutory) {
      const lines = parts.filter(([, v]) => v !== 0n).map(([k, v]) => leg(heads[k], v, DEDUCTION_NARRATION[k]));
      return lines.length > 0 ? lines : [leg(heads.other, 0n, DEDUCTION_NARRATION.other)];
    }
  }
  return [leg("2102", statutory, "Statutory deductions payable")];
}

export type AccrualLine = { accountCode: string; debitMinor: bigint; creditMinor: bigint; narration: string };

/**
 * UAT T-PERIOD review (blocker 2): the split deduction heads (2104-2108, the TDS head) may not exist yet in a tenant
 * chart -- the standard-heads backfill is a deploy prerequisite, but the accrual must never dead-letter for it. A line
 * whose head is missing goes to the 2102 "other deductions" head instead (narration says so); the caller warns.
 * Runs in the caller transaction (tenant-scoped).
 */
export async function deductionHeadFallbackTx(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any, tenantId: string, lines: AccrualLine[],
): Promise<{ lines: AccrualLine[]; missing: string[] }> {
  const heads = payrollDeductionHeads();
  const split = new Set((Object.keys(heads) as Array<keyof typeof heads>).filter((k) => k !== "other").map((k) => heads[k]).filter((c) => c !== heads.other));
  const wanted = [...new Set(lines.map((l) => l.accountCode).filter((c) => split.has(c)))];
  if (wanted.length === 0) return { lines, missing: [] };
  const found: Array<{ code: string }> = await tx.select({ code: financeHeads.code }).from(financeHeads)
    .where(and(eq(financeHeads.tenantId, tenantId), inArray(financeHeads.code, wanted)));
  const have = new Set(found.map((r) => r.code));
  const missing = wanted.filter((c) => !have.has(c));
  if (missing.length === 0) return { lines, missing };
  return {
    missing,
    lines: lines.map((l) => (missing.includes(l.accountCode)
      ? { ...l, accountCode: heads.other, narration: `${l.narration} (head ${l.accountCode} not in the chart of accounts: posted to ${heads.other})` }
      : l)),
  };
}
