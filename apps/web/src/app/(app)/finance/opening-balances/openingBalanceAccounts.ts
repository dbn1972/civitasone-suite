/**
 * Pure helpers for the opening-balances screen: chart-of-accounts validation
 * (GAP-FINANCE-OPENING-BALANCES-03) and fiscal-year status rules
 * (GAP-FINANCE-OPENING-BALANCES-06).
 */

export type CoaAccount = { code: string; name: string; status?: "active" | "inactive" | undefined };

/** "1000 — Cash in hand", or the bare code when the chart has no such account. */
export function accountLabel(code: string, accounts: readonly CoaAccount[] | undefined): string {
  const hit = accounts?.find((a) => a.code === code);
  return hit ? `${hit.code} — ${hit.name}` : code;
}

/**
 * Inline error for an account code that is not postable, or null when it is
 * acceptable. When no chart is available (`accounts` undefined / empty -- the
 * chart failed to load) the server stays the only validator and every code
 * passes, so a CoA outage cannot block a legitimate entry.
 */
export function checkAccountCode(code: string, accounts: readonly CoaAccount[] | undefined): string | null {
  if (!accounts || accounts.length === 0) return null;
  const trimmed = code.trim();
  const hit = accounts.find((a) => a.code === trimmed);
  if (!hit) return `Account code "${trimmed}" is not in the chart of accounts. Pick one from the list.`;
  if (hit.status === "inactive") return `Account ${trimmed} (${hit.name}) is inactive and cannot receive an opening balance.`;
  return null;
}

/**
 * Fiscal-year statuses (finance_fiscal_years.status: active | closed | draft)
 * for which opening balances are NOT accepted. Kept as data so the finance
 * owner can change the policy in one place (VERIFY in the PR).
 */
export const OPENING_BALANCE_BLOCKED_FY_STATUSES: readonly string[] = ["closed"];

export function fyAllowsOpeningBalances(status: string | null | undefined): boolean {
  return !OPENING_BALANCE_BLOCKED_FY_STATUSES.includes((status ?? "").trim().toLowerCase());
}

/** Option text for the fiscal-year select: flags every status other than a plain/unknown one. */
export function fiscalYearOptionLabel(fy: { code: string; label: string; status: string }): string {
  const base = `${fy.label} (${fy.code})`;
  const status = fy.status.trim().toLowerCase();
  if (status === "active") return `${base} — active`;
  if (status === "" || status === "unknown") return base;
  return `${base} — ${status}`;
}
