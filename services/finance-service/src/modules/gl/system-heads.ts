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
/** Fallback receipt head for the sale proceeds when a tenant has no 4310 yet (the standard Revenue Income head). */
export const MISC_RECEIPTS = process.env.FINANCE_MISC_RECEIPTS_CODE ?? "4001";

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
export function grnBillHeadCode(template: "govt" | "commercial" | "nonprofit" = "govt"): string {
  const configured = process.env.FINANCE_GRN_BILL_HEAD_CODE?.trim();
  return configured ? configured : templateDefaultBillHead(template);
}

/**
 * Tenant-profile S4: the default bill head CODE of a chart-of-accounts template. govt keeps 2202 (General Education, the
 * head every existing tenant has); commercial and nonprofit use 5400 (Purchases / Programme Expenses). The
 * FINANCE_GRN_BILL_HEAD_CODE / WORKS_FINANCE_BILL_HEAD_CODE env vars still win where they are read.
 */
export function templateDefaultBillHead(template: "govt" | "commercial" | "nonprofit"): string {
  return template === "govt" ? "2202" : "5400";
}

export function systemHeads(): { accumulatedDepreciationCode: string; depreciationExpenseCodes: string[]; fixedAssetCode: string } {
  return { accumulatedDepreciationCode: ACCUM_DEP, depreciationExpenseCodes: [DEP_EXPENSE, DEP_EXPENSE_STAT], fixedAssetCode: FIXED_ASSET };
}

/**
 * Section 8 NF-1/NF-2: chart codes of the inter-fund heads. ONE definition shared by the nonprofit chart (standard-heads.ts)
 * and the fund posting path (funds.ts FUND_HEADS), so the seeded heads are exactly the heads NF-1 posts to. Env-configurable
 * like every system head; read at call time so a test/deployment override is honoured by both sides.
 */
export function FUND_HEAD_CODES(): Record<"dueTo" | "dueFrom" | "transferOut" | "transferIn" | "releaseOut" | "releaseIn", string> {
  return {
    dueTo: process.env.FINANCE_FUND_DUE_TO_CODE ?? "2900",           // liability: owed to another fund
    dueFrom: process.env.FINANCE_FUND_DUE_FROM_CODE ?? "1900",       // asset: owed by another fund
    transferOut: process.env.FINANCE_FUND_TRANSFER_OUT_CODE ?? "3910", // equity: inter-fund transfer out
    transferIn: process.env.FINANCE_FUND_TRANSFER_IN_CODE ?? "3911",   // equity: inter-fund transfer in
    releaseOut: process.env.FINANCE_FUND_RELEASE_OUT_CODE ?? "3920",   // equity: released from restriction (out)
    releaseIn: process.env.FINANCE_FUND_RELEASE_IN_CODE ?? "3921",     // equity: released from restriction (in)
  };
}

/**
 * Section 8 NF-3: chart codes of the grants-in-aid heads. ONE definition shared by the nonprofit chart (standard-heads.ts) and
 * the grants posting module (modules/grants), so the seeded heads are exactly the heads NF-3 posts to and the two cannot drift.
 * Env-configurable like every system head (FINANCE_GRANT_*_CODE), read at call time. FAIL-SAFE: an override that is malformed,
 * repeats another grant code, or lands on a code finance itself already posts to (the system / inter-fund / payroll / cash
 * codes) throws GRANT_HEAD_CODE_COLLISION instead of silently mixing grant money into an unrelated head.
 */
export type GrantHeadCodes = {
  revenueReceiptSalary: string;   // 2320 liability: unutilised revenue grant (salary)
  revenueReceiptGeneral: string;  // 2330 liability: unutilised revenue grant (general)
  revenueIncomeSalary: string;    // 4430 income: salary grant recognised on utilisation
  revenueIncomeGeneral: string;   // 4440 income: general grant recognised on utilisation
  capitalReceipt: string;         // 2340 liability: unutilised capital grant
  capitalDeferred: string;        // 2350 non-current liability: deferred-income reservoir (deferred_income policy)
  capitalRelease: string;         // 4450 income: capital grant released in step with depreciation
  capitalFund: string;            // 3300 equity: Capital Grant Fund (capital_fund policy)
};

export class GrantHeadCodeError extends Error {
  readonly code = "GRANT_HEAD_CODE_COLLISION";
  constructor(message: string) { super(`GRANT_HEAD_CODE_COLLISION: ${message}`); this.name = "GrantHeadCodeError"; }
}

/** Every code finance already posts to by role (the constants above, the inter-fund heads, payroll deductions, cash). */
export function reservedSystemCodes(): string[] {
  return [
    DEP_EXPENSE, DEP_EXPENSE_STAT, ACCUM_DEP, FIXED_ASSET, ASSET_SALE_RECEIPT, MISC_RECEIPTS, ACCUMULATED_FUND,
    STORES_INVENTORY, GRNI, STORES_SUSPENSE, STORES_CONSUMPTION,
    process.env.FINANCE_CASH_CODE ?? "1100",
    ...Object.values(payrollDeductionHeads()),
    ...Object.values(FUND_HEAD_CODES()),
  ];
}

/** Pure: the codes must be well-formed, distinct from each other, and outside `reserved`. Throws GrantHeadCodeError. */
export function assertGrantHeadCodes(codes: GrantHeadCodes, reserved: Iterable<string> = reservedSystemCodes()): void {
  const taken = new Set(reserved);
  const seen = new Map<string, string>();
  for (const [role, code] of Object.entries(codes)) {
    if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$/.test(code)) throw new GrantHeadCodeError(`grant head ${role} has an invalid code "${code}"`);
    const prior = seen.get(code);
    if (prior) throw new GrantHeadCodeError(`grant heads ${prior} and ${role} share the code ${code}`);
    seen.set(code, role);
    if (taken.has(code)) throw new GrantHeadCodeError(`grant head ${role} (${code}) collides with a core system head code`);
  }
}

export function GRANT_HEAD_CODES(): GrantHeadCodes {
  const env = (k: string, d: string) => process.env[k]?.trim() || d;
  const codes: GrantHeadCodes = {
    revenueReceiptSalary: env("FINANCE_GRANT_REV_RECEIPT_SALARY_CODE", "2320"),
    revenueReceiptGeneral: env("FINANCE_GRANT_REV_RECEIPT_GENERAL_CODE", "2330"),
    revenueIncomeSalary: env("FINANCE_GRANT_REV_INCOME_SALARY_CODE", "4430"),
    revenueIncomeGeneral: env("FINANCE_GRANT_REV_INCOME_GENERAL_CODE", "4440"),
    capitalReceipt: env("FINANCE_GRANT_CAP_RECEIPT_CODE", "2340"),
    capitalDeferred: env("FINANCE_GRANT_CAP_DEFERRED_CODE", "2350"),
    capitalRelease: env("FINANCE_GRANT_CAP_RELEASE_CODE", "4450"),
    capitalFund: env("FINANCE_GRANT_CAP_FUND_CODE", "3300"),
  };
  assertGrantHeadCodes(codes);
  return codes;
}
