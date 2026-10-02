import { isBudgetableHead } from "@civitasone/schemas/budget-heads";

/** A row of GET /v1/finance/accounts (`type` = the head's accounting nature). */
export type AccountRow = { id: string; code?: string; name?: string; type?: string };

/**
 * Only expenditure heads can carry a Budget Estimate or a sanction
 * (GAP-FINANCE-BUDGET-FORMULATION-NEW-02). Uses the SAME shared rule as
 * finance-service's POST /v1/finance/budgets guard: an explicit non-expense
 * `type` is excluded, otherwise the LMMHA major-head range of the code decides
 * (2xxx-7xxx budgetable; 0xxx-1xxx receipts and 8xxx public account not).
 */
export function budgetableHeads(rows: AccountRow[]): AccountRow[] {
  return rows.filter((a) => isBudgetableHead({ classification: a.type ?? null, code: a.code ?? "" }));
}

export function headOptionLabel(a: AccountRow): string {
  return [a.code, a.name].filter(Boolean).join(" · ") || a.id;
}
