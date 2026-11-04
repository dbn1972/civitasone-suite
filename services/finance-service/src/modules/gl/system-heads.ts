/**
 * The chart-of-accounts codes finance itself posts to for the asset lifecycle. Single source of truth: the GL consumer
 * posts depreciation / disposal to these, and asset-service asks for them (GET /v1/finance/accounts/system-heads, over
 * the internal service path) so it never duplicates them -- e.g. it must refuse accumulated depreciation as a CWIP head.
 */
export const DEP_EXPENSE = process.env.FINANCE_DEP_EXPENSE_CODE ?? "5100";
export const DEP_EXPENSE_STAT = process.env.FINANCE_STAT_DEP_EXPENSE_CODE ?? "5101";
export const ACCUM_DEP = process.env.FINANCE_ACCUM_DEP_CODE ?? "1250";
export const FIXED_ASSET = process.env.FINANCE_FIXED_ASSET_CODE ?? "1200";

/**
 * UAT L2-N6: stores heads for inventory-service stock movements (gl/inventory-movement.ts): the stock (inventory)
 * asset and the expense a stores issue is consumed to.
 */
export const STORES_INVENTORY = process.env.FINANCE_STORES_INVENTORY_CODE ?? "1400";
export const STORES_CONSUMPTION = process.env.FINANCE_STORES_CONSUMPTION_CODE ?? "5300";

/**
 * Head CODE of the AP bill drafted from an accepted GRN, resolved per tenant (finance.bill.create looks it up in the
 * bill tenant chart of accounts). Default 2202 is the head the old literal id pointed at. UAT L2-N6: it is also the
 * GRN clearing (goods received not invoiced) head a stock receipt credits, so the GRN bill clears it.
 */
export function grnBillHeadCode(): string {
  const configured = process.env.FINANCE_GRN_BILL_HEAD_CODE?.trim();
  return configured ? configured : "2202";
}

export function systemHeads(): { accumulatedDepreciationCode: string; depreciationExpenseCodes: string[]; fixedAssetCode: string } {
  return { accumulatedDepreciationCode: ACCUM_DEP, depreciationExpenseCodes: [DEP_EXPENSE, DEP_EXPENSE_STAT], fixedAssetCode: FIXED_ASSET };
}
