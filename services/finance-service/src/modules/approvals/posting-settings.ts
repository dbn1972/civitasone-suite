/**
 * Section 8 NF-1 (S4): the per-posting settings read.
 *
 * `gl.finance_settings` carries two switches every journal posting consults: `budget_control` (the budget check) and
 * `fund_accounting` (the fund seam). They used to be read by two separate selects in one posting transaction. This reads
 * the row ONCE and returns both, plus the tenant's GENERAL fund id (a scalar subquery in the same statement), so the
 * fail-closed rule (design contract #5) is decided from the same snapshot as the flag.
 *
 *   - no settings row, or an unknown budget_control => budgetControl "mandatory" (the existing default);
 *   - fund_accounting NULL / false / no row        => fundAccounting false (OFF: strict identity downstream);
 *   - fund_accounting true                          => generalFundId must exist, else assertFundPostingReady() refuses.
 *
 * Callers that already hold the value pass it down (fundContext(tx, tenantId, ps), loadBudgetControlTx(tx, tenantId, ps)),
 * so the row is read once per posting, not twice.
 */
import { eq, sql } from "drizzle-orm";
import { financeSettings } from "./schema.js";
import { toBudgetControl, DomainError, type BudgetControl } from "./domain.js";

export type PostingSettings = {
  budgetControl: BudgetControl;
  /** The stored flag: NULL / false / absent row are all false. */
  fundAccounting: boolean;
  /** The tenant's GENERAL fund id when it exists. Meaningful only when fundAccounting is true. */
  generalFundId: string | null;
};

export async function loadPostingSettingsTx(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any, tenantId: string,
): Promise<PostingSettings> {
  const rows: Array<{ m?: string; f?: boolean | null; g?: string | null }> = await tx
    .select({
      m: financeSettings.budgetControl,
      f: financeSettings.fundAccounting,
      g: sql<string | null>`(SELECT gf.id::text FROM gl.funds gf WHERE gf.tenant_id = ${tenantId}::uuid AND gf.code = 'GENERAL' LIMIT 1)`,
    })
    .from(financeSettings)
    .where(eq(financeSettings.tenantId, tenantId)).limit(1);
  const r = rows[0];
  return { budgetControl: toBudgetControl(r?.m), fundAccounting: r?.f === true, generalFundId: r?.g ?? null };
}

/**
 * Design contract #5 (fail-closed): fund accounting ON but the fund master is not ready => REFUSE to post. Never fall back
 * to untagged (govt-shaped) rows. The code is a deterministic refusal (FUND_ matches gl/repo.ts REFUSAL_CODE).
 */
export function assertFundPostingReady(ps: PostingSettings): void {
  if (ps.fundAccounting && !ps.generalFundId) {
    throw new DomainError(
      "FUND_ACCOUNTING_NOT_READY",
      "fund accounting is on for this tenant but its GENERAL fund does not exist; refusing to post an untagged journal. Activate the fund master first",
    );
  }
}
