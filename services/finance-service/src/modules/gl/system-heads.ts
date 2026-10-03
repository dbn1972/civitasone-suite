/**
 * The chart-of-accounts codes finance itself posts to for the asset lifecycle. Single source of truth: the GL consumer
 * posts depreciation / disposal to these, and asset-service asks for them (GET /v1/finance/accounts/system-heads, over
 * the internal service path) so it never duplicates them -- e.g. it must refuse accumulated depreciation as a CWIP head.
 */
export const DEP_EXPENSE = process.env.FINANCE_DEP_EXPENSE_CODE ?? "5100";
export const DEP_EXPENSE_STAT = process.env.FINANCE_STAT_DEP_EXPENSE_CODE ?? "5101";
export const ACCUM_DEP = process.env.FINANCE_ACCUM_DEP_CODE ?? "1250";
export const FIXED_ASSET = process.env.FINANCE_FIXED_ASSET_CODE ?? "1200";

export function systemHeads(): { accumulatedDepreciationCode: string; depreciationExpenseCodes: string[]; fixedAssetCode: string } {
  return { accumulatedDepreciationCode: ACCUM_DEP, depreciationExpenseCodes: [DEP_EXPENSE, DEP_EXPENSE_STAT], fixedAssetCode: FIXED_ASSET };
}
