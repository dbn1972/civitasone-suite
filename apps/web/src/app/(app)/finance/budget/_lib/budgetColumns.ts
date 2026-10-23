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
 * Budget row status values the Formulation list can show (GAP-FINANCE-BUDGET-FORMULATION-05).
 *
 * What finance-service really reports today: budget.finance_budgets has NO status column, so GET /v1/finance/budgets
 * computes one per row (budget/queries.ts listBudgetSummaries): `exhausted` once utilised >= allocated, else `active`.
 * A freshly proposed estimate therefore reads `active`. The approval vocabulary (draft / pending / submitted /
 * approved / rejected) is kept for a row that carries one, but no live row does until the budget module gets a real
 * lifecycle (an owner decision, see docs/gap-ledger/finance.md). The keys of this map ARE the enum: the tabs, the stat
 * cards and the pill all read it, and each value has exactly one tab (budgetTabOf) and an explicit pill tone
 * (ds/StatusPill). The words shown to the user come from the financeBudgetFormulation i18n namespace (status.*); these
 * English labels are the code-side fallback and the source of the enum.
 */
export const BUDGET_STATUS_LABEL = {
  active: "Active",
  exhausted: "Exhausted",
  draft: "Draft",
  pending: "Pending",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
} as const;
export type BudgetStatus = keyof typeof BUDGET_STATUS_LABEL;
export const BUDGET_STATUSES = Object.keys(BUDGET_STATUS_LABEL) as BudgetStatus[];

export const BUDGET_TAB_ALL = "all";
/** Home of any status value that is not in the enum (a future server value): it is still listed, never dropped. */
export const BUDGET_TAB_OTHER = "other";
export type BudgetTab = typeof BUDGET_TAB_ALL | typeof BUDGET_TAB_OTHER | BudgetStatus;

export function isBudgetStatus(value: unknown): value is BudgetStatus {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(BUDGET_STATUS_LABEL, value);
}

/** The ONE status tab (besides "all") a row with this status is listed under. */
export function budgetTabOf(status: string): BudgetStatus | typeof BUDGET_TAB_OTHER {
  return isBudgetStatus(status) ? status : BUDGET_TAB_OTHER;
}

/**
 * Tabs to offer for these rows: All, then every status that has at least one row (enum order), then Other. A tab that
 * could never match anything is not offered (the old Submitted / Approved / Pending tabs were always empty against the
 * live API).
 */
export function budgetTabsFor(rows: ReadonlyArray<{ status: string }>): BudgetTab[] {
  const present = new Set(rows.map((r) => budgetTabOf(r.status)));
  const tabs: BudgetTab[] = [BUDGET_TAB_ALL, ...BUDGET_STATUSES.filter((s) => present.has(s))];
  if (present.has(BUDGET_TAB_OTHER)) tabs.push(BUDGET_TAB_OTHER);
  return tabs;
}

/** A `?tab=` value from the URL, or null when it is not a tab this page knows (a stale or hand-typed link). */
export function parseBudgetTab(value: unknown): BudgetTab | null {
  if (value === BUDGET_TAB_ALL || value === BUDGET_TAB_OTHER) return value;
  return isBudgetStatus(value) ? value : null;
}

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
