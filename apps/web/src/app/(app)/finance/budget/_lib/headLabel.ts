/**
 * GAP-FINANCE-BUDGET-ALLOCATION-01 / MONITORING-02: budget rows carry a head
 * uuid; finance-service now joins the head's code + name onto allocation and
 * monitoring rows. Officers identify a head by "3054 · Roads and Bridges",
 * never by its uuid. A head that no longer resolves renders as an explicit
 * "Unknown head" (the uuid stays available as a tooltip for support) -- a
 * label is never guessed.
 */
export const UNKNOWN_HEAD = "Unknown head";

export function budgetHeadLabel(row: { headCode?: string | null; headName?: string | null }): string {
  const code = row.headCode?.trim();
  const name = row.headName?.trim();
  if (code && name) return `${code} · ${name}`;
  if (code) return code;
  if (name) return name;
  return UNKNOWN_HEAD;
}
