/**
 * Section 8 NF-7 (the "B5" resolver): which statutory statement set a tenant gets, keyed on the STORED chart template
 * (gl.finance_settings.coa_template) -- never on an edition or profile code (NF-0 lint). PURE.
 *
 *  - govt        the existing routes in financial-statements/routes.ts, UNCHANGED (this module only DESCRIBES them; it holds no
 *                classifier, so the govt leading-code-digit classification is not duplicated).
 *  - nonprofit   the fund-wise Schedule III set in fund-routes.ts (Balance Sheet, Income & Expenditure, Receipts & Payments,
 *                UC schedule), classified by the stored budget.finance_heads.statement_class (migration 0169).
 *  - commercial  MSME M8: keyed on the STORED gl.finance_settings.entity_type (never an edition) -- company -> Schedule III family
 *                (P&L, Balance Sheet, Cash Flow, Notes); LLP -> the same AS-based family with a "Form 8/11 is v2" marker;
 *                partnership / proprietorship -> Trading + P&L + Balance Sheet (ITR-3/4/5 shape). Commercial with no stored
 *                entity_type is available=false (fail-closed: nothing is inferred). Routes: commercial-routes.ts.
 * An unknown / missing template resolves to govt (fail-safe, same rule as gl/coa-template.ts).
 */
export type StatementSetId = "govt" | "nonprofit" | "commercial";
export type StatementDescriptor = { key: string; title: string; route: string };
export type CommercialFamilyId = "schedule_iii" | "trading_pl_bs";
export type StatementSet = {
  id: StatementSetId; available: boolean; fundWise: boolean; requiresFundAccounting: boolean; statements: StatementDescriptor[];
  family?: CommercialFamilyId; markers?: string[]; // commercial only; absent on govt / nonprofit so their payload is unchanged
};

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
const C = `${B}/commercial`;
const SCHEDULE_III: StatementDescriptor[] = [
  { key: "profit_and_loss", title: "Statement of Profit and Loss (Schedule III)", route: `${C}/profit-and-loss` },
  { key: "balance_sheet", title: "Balance Sheet (Schedule III)", route: `${C}/balance-sheet` },
  { key: "changes_in_equity", title: "Statement of Changes in Equity", route: `${C}/changes-in-equity` },
  { key: "cash_flow", title: "Cash Flow Statement (indirect)", route: `${C}/cash-flow` },
  { key: "notes", title: "Notes to the financial statements", route: `${C}/set` },
];
const TRADING_PL_BS: StatementDescriptor[] = [
  { key: "trading_account", title: "Trading Account", route: `${C}/trading-account` },
  { key: "profit_and_loss", title: "Profit and Loss Account", route: `${C}/profit-and-loss` },
  { key: "balance_sheet", title: "Balance Sheet", route: `${C}/balance-sheet` },
];
const commercial = (family: CommercialFamilyId, statements: StatementDescriptor[], markers: string[] = []): StatementSet =>
  ({ id: "commercial", available: true, fundWise: false, requiresFundAccounting: false, statements, family, markers });
const COMMERCIAL_UNSET: StatementSet = { id: "commercial", available: false, fundWise: false, requiresFundAccounting: false, statements: [] };

/**
 * `entityType` splits the commercial template (company / llp / partnership / proprietorship). It is the STORED setting; an unset or
 * unknown value on a commercial tenant resolves to "unavailable", never to a guess.
 */
export function statementSetFor(coaTemplate: string | null | undefined, entityType?: string | null): StatementSet {
  switch (coaTemplate) {
    case "nonprofit": return NONPROFIT;
    case "commercial":
      switch (entityType) {
        case "company": return commercial("schedule_iii", SCHEDULE_III);
        case "llp": return commercial("schedule_iii", SCHEDULE_III, ["LLP_FORM_8_11_V2"]);
        case "partnership":
        case "proprietorship": return commercial("trading_pl_bs", TRADING_PL_BS);
        default: return COMMERCIAL_UNSET;
      }
    default: return GOVT;
  }
}
