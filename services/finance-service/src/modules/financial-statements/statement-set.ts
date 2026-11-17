/**
 * Section 8 NF-7 (the "B5" resolver): which statutory statement set a tenant gets, keyed on the STORED chart template
 * (gl.finance_settings.coa_template) -- never on an edition or profile code (NF-0 lint). PURE.
 *
 *  - govt        the existing routes in financial-statements/routes.ts, UNCHANGED (this module only DESCRIBES them; it holds no
 *                classifier, so the govt leading-code-digit classification is not duplicated).
 *  - nonprofit   the fund-wise Schedule III set in fund-routes.ts (Balance Sheet, Income & Expenditure, Receipts & Payments,
 *                UC schedule), classified by the stored budget.finance_heads.statement_class (migration 0169).
 *  - commercial  reserved: no set is built yet (available=false). Adding it later = one more case here + its routes.
 * An unknown / missing template resolves to govt (fail-safe, same rule as gl/coa-template.ts).
 */
export type StatementSetId = "govt" | "nonprofit" | "commercial";
export type StatementDescriptor = { key: string; title: string; route: string };
export type StatementSet = { id: StatementSetId; available: boolean; fundWise: boolean; requiresFundAccounting: boolean; statements: StatementDescriptor[] };

const B = "/v1/finance/statements";
const GOVT: StatementSet = {
  id: "govt", available: true, fundWise: false, requiresFundAccounting: false,
  statements: [
    { key: "trial_balance", title: "Trial Balance", route: `${B}/trial-balance-check` },
    { key: "balance_sheet", title: "Balance Sheet", route: `${B}/balance-sheet` },
    { key: "income_expenditure", title: "Income & Expenditure", route: `${B}/profit-and-loss` },
    { key: "receipts_payments", title: "Receipts & Payments", route: `${B}/receipts-payments` },
    { key: "cash_flow", title: "Cash Flow", route: `${B}/cash-flow` },
  ],
};
const NONPROFIT: StatementSet = {
  id: "nonprofit", available: true, fundWise: true, requiresFundAccounting: true,
  statements: [
    { key: "balance_sheet", title: "Balance Sheet (fund-wise)", route: `${B}/fund-wise/balance-sheet` },
    { key: "income_expenditure", title: "Income & Expenditure (fund-wise)", route: `${B}/fund-wise/income-expenditure` },
    { key: "receipts_payments", title: "Receipts & Payments (fund-wise)", route: `${B}/fund-wise/receipts-payments` },
    { key: "utilisation_certificates", title: "Grant Utilisation Certificates", route: `${B}/fund-wise/utilisation-certificates` },
  ],
};
const COMMERCIAL: StatementSet = { id: "commercial", available: false, fundWise: false, requiresFundAccounting: false, statements: [] };

/** `entityType` is reserved for a later split inside a template (e.g. trust vs Section 8 company); it does not branch today. */
export function statementSetFor(coaTemplate: string | null | undefined, entityType?: string | null): StatementSet {
  void entityType;
  switch (coaTemplate) {
    case "nonprofit": return NONPROFIT;
    case "commercial": return COMMERCIAL;
    default: return GOVT;
  }
}
