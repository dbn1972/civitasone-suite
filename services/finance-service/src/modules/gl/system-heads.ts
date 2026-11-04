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
 * UAT T-PERIOD D-12: on the CASH basis the asset register is a memorandum -- a disposal posts no cost / accumulated
 * depreciation reversal, only the sale proceeds RECEIPT: Dr cash / Cr this receipt head.
 */
export const ASSET_SALE_RECEIPT = process.env.FINANCE_ASSET_SALE_RECEIPT_CODE ?? "4310";

/**
 * UAT T-PERIOD D-05: the fund that carries the net of the income and expenditure heads into the next financial year
 * (they start the new year at zero; the year-end close generates its opening balance). Equity head.
 */
export const ACCUMULATED_FUND = process.env.FINANCE_ACCUMULATED_FUND_CODE ?? "3100";

/**
 * UAT T-PERIOD D-10: employee salary deductions are distinct liability heads (challan-wise clearing), configurable per
 * deployment. "other" (LIC, society, loan recoveries ...) stays on 2102.
 */
export function payrollDeductionHeads(): Record<"tds" | "gpf" | "nps" | "pf" | "esi" | "pt" | "other", string> {
  const env = (k: string, d: string) => process.env[k]?.trim() || d;
  return {
    tds: env("PAYROLL_GL_TDS_HEAD", process.env.FINANCE_TDS_PAYABLE_CODE?.trim() || "2200"),
    gpf: env("PAYROLL_GL_GPF_HEAD", "2104"),
    nps: env("PAYROLL_GL_NPS_HEAD", "2105"),
    pf: env("PAYROLL_GL_EPF_HEAD", "2106"),
    esi: env("PAYROLL_GL_ESI_HEAD", "2107"),
    pt: env("PAYROLL_GL_PT_HEAD", "2108"),
    other: env("PAYROLL_GL_OTHER_DEDUCTIONS_HEAD", "2102"),
  };
}

/**
 * UAT L2-N6: stores heads for inventory-service stock movements on the ACCRUAL basis only (gl/inventory-movement.ts;
 * a cash-basis tenant -- the default, government accounts -- posts no stock journal and needs none of them):
 *  - STORES_INVENTORY: the stock asset;
 *  - GRNI: goods received not invoiced, a LIABILITY credited by a GRN stock receipt and cleared when the GRN bill is
 *    passed (gl/grni-clearing.ts) -- never a budget / expense head;
 *  - STORES_SUSPENSE: liability credited by a receipt WITHOUT a GRN (opening stock, store return, inter-office);
 *  - STORES_CONSUMPTION: the default expense of a stores issue that names no consuming head.
 */
export const STORES_INVENTORY = process.env.FINANCE_STORES_INVENTORY_CODE ?? "1400";
export const GRNI = process.env.FINANCE_GRNI_CODE ?? "2080";
export const STORES_SUSPENSE = process.env.FINANCE_STORES_SUSPENSE_CODE ?? "2085";
export const STORES_CONSUMPTION = process.env.FINANCE_STORES_CONSUMPTION_CODE ?? "5300";

/**
 * Head CODE of the AP bill drafted from an accepted GRN, resolved per tenant (finance.bill.create looks it up in the
 * bill tenant chart of accounts). Default 2202 is the head the old literal id pointed at. It is a budget / expense
 * head: a stock receipt never credits it (UAT L2-N6 review), on accrual GRNI is cleared against it instead.
 */
export function grnBillHeadCode(): string {
  const configured = process.env.FINANCE_GRN_BILL_HEAD_CODE?.trim();
  return configured ? configured : "2202";
}

export function systemHeads(): { accumulatedDepreciationCode: string; depreciationExpenseCodes: string[]; fixedAssetCode: string } {
  return { accumulatedDepreciationCode: ACCUM_DEP, depreciationExpenseCodes: [DEP_EXPENSE, DEP_EXPENSE_STAT], fixedAssetCode: FIXED_ASSET };
}
