/**
 * GAP-FINANCE-BUDGET-REVISED-ESTIMATES-05 / FORMULATION-01: one vocabulary for
 * the fields of a budget row, shared by Budget Formulation and Revised
 * Estimates so the two pages can never again disagree on what "BE" means.
 *
 *   beMinor          Budget Estimate (the original proposal)
 *   reMinor          Revised Estimate
 *   sanctionedAmount Sanctioned (money committed against the head)
 *   releasedAmount   Released (money actually released, BE-capped)
 *
 * All four are paise decimal STRINGS (BudgetSummary's contract) -- they stay
 * strings/bigints end to end and are only formatted by formatMoney().
 */
import type { BudgetSummary } from "@civitasone/types";
import { fiscalYearLabel } from "@/lib/fiscalYear";

export const BUDGET_COLUMN_LABELS = {
  be: "Budget Estimate (BE)",
  re: "Revised Estimate (RE)",
  sanctioned: "Sanctioned",
  released: "Released",
  priorBe: "Last Year (BE)",
} as const;

/**
 * Budget row status values (finance-service budget.finance_budgets.status,
 * varchar default "draft"; the web lists them under the Formulation tabs) and
 * the ONE label each is shown under -- the tab, the stat card and the pill all
 * read this map (GAP-FINANCE-BUDGET-FORMULATION-05).
 */
export const BUDGET_STATUS_LABEL = {
  draft: "Draft",
  pending: "Pending",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
} as const;
export type BudgetStatus = keyof typeof BUDGET_STATUS_LABEL;

/** Strict paise parser: an integer string/number -> bigint, else null (never a fabricated 0). */
export function parseMinor(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return Number.isSafeInteger(value) ? BigInt(value) : null;
  if (typeof value === "string" && /^[+-]?\d+$/.test(value.trim())) return BigInt(value.trim());
  return null;
}

/** Grouping key for "the same head in another FY" (a BudgetSummary carries no head uuid). */
export function budgetHeadKey(b: Pick<BudgetSummary, "majorHead" | "subHead">): string {
  return `${b.majorHead}|${b.subHead ?? ""}`;
}

/** "2026-27" -> "2025-26", or null for a malformed label. */
export function previousFinancialYear(fy: string): string | null {
  const m = /^(\d{4})-\d{2}$/.exec(fy);
  return m ? fiscalYearLabel(Number(m[1]) - 1) : null;
}

/**
 * Last year's BE per head: head key -> sum of beMinor (paise string) for the
 * previous FY. A head with no prior-FY row is simply absent, so the table shows
 * "—" rather than a made-up figure.
 */
export function priorYearBeByHead(all: readonly BudgetSummary[], fy: string): Record<string, string> {
  const prev = previousFinancialYear(fy);
  const out: Record<string, bigint> = {};
  if (!prev) return {};
  for (const b of all) {
    if (b.financialYear !== prev) continue;
    const be = parseMinor(b.beMinor);
    if (be === null) continue;
    const k = budgetHeadKey(b);
    out[k] = (out[k] ?? 0n) + be;
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.toString()]));
}

/**
 * Revised-vs-budget variance in basis points, BigInt end to end (truncated
 * toward zero). null when either side is missing/unparseable or BE is not
 * positive (a variance against a zero/negative base is undefined, not 0%).
 */
export function varianceBps(be: bigint | null, re: bigint | null): bigint | null {
  if (be === null || re === null || be <= 0n) return null;
  return ((re - be) * 10000n) / be;
}

/**
 * GAP-FINANCE-BUDGET-REVISED-ESTIMATES-04: a revision of at least this size
 * (|RE - BE| / BE) is "material" and highlighted. 10% is the conservative
 * default pending a finance policy decision -- change it here (or feed it from
 * tenant config) rather than in the page/table.
 */
export const MATERIAL_VARIANCE_BPS = 1000n;

export function isMaterialVariance(bps: bigint | null, threshold: bigint = MATERIAL_VARIANCE_BPS): boolean {
  if (bps === null) return false;
  return (bps < 0n ? -bps : bps) >= threshold;
}
