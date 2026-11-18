/**
 * MSME M8: commercial statements, selected by the STORED entity_type (statement-set.ts) -- two families:
 *   schedule_iii   company (and LLP, until Form 8/11 lands in v2): Profit & Loss, Balance Sheet, Cash Flow, Notes (Companies Act Sch III)
 *   trading_pl_bs  partnership / proprietorship: Trading Account, Profit & Loss Account, Balance Sheet (ITR-3/4/5 shape)
 *
 * PURE: no database, no clock, no environment (the presentation codes are passed in). Loaders live in commercial-statements-repo.ts.
 *
 * CLASSIFICATION IS THE STORED budget.finance_heads.statement_class -- NEVER the code prefix. (gl/queries.ts / head-nature.ts read
 * `2xxx` as a liability, which is right for 2300 GST Payable only by luck of the chart; the nature here comes from the stored class,
 * so a commercial head cannot be misclassified by its number.) A head with a balance and no stored class refuses the statement
 * (fail-closed, STATEMENT_CLASS_MISSING) instead of guessing.
 * The PresentationConfig only decides the LINE GROUPING inside a stored class (e.g. which expense heads print as depreciation vs
 * finance cost); it never changes a head's class or an amount, and every total is the sum of the classified heads.
 *
 * Amounts: signed paise (bigint) inside, decimal strings (`...Minor`) on the way out. Row balances are debit-positive
 * (closing = opening + dr - cr); every line is printed in the natural sign of its class.
 * CA-VERIFY: Schedule III line grouping, AS vs Ind AS (framework toggle, default AS), 44AD/44ADA presumptive taxation (not built),
 * P&L comparatives (balance sheet carries the prior-year column; P&L comparatives are a follow-up).
 */
export type CommercialFamily = "schedule_iii" | "trading_pl_bs";
export type Framework = "as" | "ind_as";
export type Nature = "asset" | "liability" | "equity" | "income" | "expense";

export type CommercialRow = {
  code: string; name: string; statementClass: string | null;
  openingMinor: bigint; debitMinor: bigint; creditMinor: bigint; closingMinor: bigint;
};

/** Stored statement_class (migration 0169) -> nature. Deliberately independent of the code. */
export const NATURE_OF_STORED_CLASS: Readonly<Record<string, Nature>> = {
  asset: "asset", current_liability: "liability", non_current_liability: "liability", dividend_payable: "liability",
  equity: "equity", reserve: "equity", capital_reserve: "equity", govt_equity: "equity", income: "income", expense: "expense",
};

/** Line grouping inside a stored class (presentation only). Built from the one shared head definitions by the repo. */
export type PresentationConfig = {
  accumulatedFund: string;
  fixedAssetCodes: ReadonlySet<string>;     // gross block
  accumDepCodes: ReadonlySet<string>;       // contra to the gross block
  cashCodes: ReadonlySet<string>;           // cash and bank
  borrowingCodes: ReadonlySet<string>;      // current-liability-class heads that are financing (short-term borrowings)
  otherIncomeCodes: ReadonlySet<string>;    // income-class heads printed under Other income
  directExpenseCodes: ReadonlySet<string>;  // cost of materials / purchases (Trading Account)
  employeeCodes: ReadonlySet<string>;
  financeCostCodes: ReadonlySet<string>;
  depreciationCodes: ReadonlySet<string>;
  taxExpenseCodes: ReadonlySet<string>;
};

export type StLine = { code: string | null; name: string; amountMinor: string; priorYearMinor?: string };
export type StGroup = { key: string; label: string; lines: StLine[]; totalMinor: string; priorYearTotalMinor?: string };

const sum = (xs: Array<{ v: bigint }>): bigint => xs.reduce((a, x) => a + x.v, 0n);
const s = (v: bigint): string => v.toString();

export class StatementClassMissingError extends Error {
  readonly code = "STATEMENT_CLASS_MISSING";
  constructor(readonly heads: string[]) {
    super(`these heads have a balance but no stored statement_class, so they cannot be placed on a commercial statement: ${heads.join(", ")}`);
  }
}

type Cl = CommercialRow & { nature: Nature; natural: bigint; naturalOpening: bigint };

/** Classify by the stored class; throws StatementClassMissingError for a moving head with no / unknown stored class. */
export function classify(rows: ReadonlyArray<CommercialRow>): Cl[] {
  const missing: string[] = [];
  const out: Cl[] = [];
  for (const r of rows) {
    if (r.openingMinor === 0n && r.debitMinor === 0n && r.creditMinor === 0n) continue;
    const nature = r.statementClass ? NATURE_OF_STORED_CLASS[r.statementClass] : undefined;
    if (!nature) { missing.push(r.code); continue; }
    const debitNormal = nature === "asset" || nature === "expense";
    out.push({ ...r, nature, natural: debitNormal ? r.closingMinor : -r.closingMinor, naturalOpening: debitNormal ? r.openingMinor : -r.openingMinor });
  }
  if (missing.length > 0) throw new StatementClassMissingError(missing.sort());
  return out.sort((a, b) => a.code.localeCompare(b.code));
}

const lineOf = (c: Cl, prior = false): StLine => ({ code: c.code, name: c.name, amountMinor: s(c.natural), ...(prior ? { priorYearMinor: s(c.naturalOpening) } : {}) });
const group = (key: string, label: string, cs: Cl[], prior = false, extra: StLine[] = []): StGroup => {
  const lines = [...cs.map((c) => lineOf(c, prior)), ...extra];
  return {
    key, label, lines, totalMinor: s(sum(lines.map((l) => ({ v: BigInt(l.amountMinor) })))),
    ...(prior ? { priorYearTotalMinor: s(sum(lines.map((l) => ({ v: BigInt(l.priorYearMinor ?? "0") })))) } : {}),
  };
};
const total = (g: StGroup[]): bigint => g.reduce((a, x) => a + BigInt(x.totalMinor), 0n);
const priorTotal = (g: StGroup[]): bigint => g.reduce((a, x) => a + BigInt(x.priorYearTotalMinor ?? "0"), 0n);

// ---- Profit & Loss (+ Trading Account) -----------------------------------------------------------------------------------

type PlParts = {
  revenue: Cl[]; otherIncome: Cl[]; direct: Cl[]; employee: Cl[]; finance: Cl[]; depreciation: Cl[]; tax: Cl[]; otherExp: Cl[];
};
function plParts(cs: Cl[], cfg: PresentationConfig): PlParts {
  const inc = cs.filter((c) => c.nature === "income"), exp = cs.filter((c) => c.nature === "expense");
  const take = (set: ReadonlySet<string>, xs: Cl[]) => xs.filter((c) => set.has(c.code));
  const direct = take(cfg.directExpenseCodes, exp), employee = take(cfg.employeeCodes, exp), finance = take(cfg.financeCostCodes, exp);
  const depreciation = take(cfg.depreciationCodes, exp), tax = take(cfg.taxExpenseCodes, exp);
  const used = new Set([...direct, ...employee, ...finance, ...depreciation, ...tax].map((c) => c.code));
  return {
    revenue: inc.filter((c) => !cfg.otherIncomeCodes.has(c.code)), otherIncome: take(cfg.otherIncomeCodes, inc),
    direct, employee, finance, depreciation, tax, otherExp: exp.filter((c) => !used.has(c.code)),
  };
}
const t = (xs: Cl[]): bigint => xs.reduce((a, c) => a + c.natural, 0n);

export type ProfitAndLoss = {
  family: CommercialFamily; groups: StGroup[];
  totalRevenueMinor: string; totalExpensesMinor: string; profitBeforeTaxMinor: string; taxExpenseMinor: string; profitAfterTaxMinor: string;
  result: "profit" | "loss";
};

/** Schedule III Statement of Profit and Loss: I revenue, II other income, III total, IV expenses, V PBT, VI tax, VII PAT. */
export function scheduleIIIProfitAndLoss(cs: Cl[], cfg: PresentationConfig): ProfitAndLoss {
  const p = plParts(cs, cfg);
  const income = [group("revenue_from_operations", "I. Revenue from operations", p.revenue), group("other_income", "II. Other income", p.otherIncome)];
  const expenses = [
    group("cost_of_materials", "Cost of materials consumed / purchases", p.direct), group("employee_benefits", "Employee benefits expense", p.employee),
    group("finance_costs", "Finance costs", p.finance), group("depreciation", "Depreciation and amortisation expense", p.depreciation),
    group("other_expenses", "Other expenses", p.otherExp),
  ];
  const totalRev = total(income), totalExp = total(expenses), pbt = totalRev - totalExp, tax = t(p.tax), pat = pbt - tax;
  return {
    family: "schedule_iii", groups: [...income, ...expenses, ...(p.tax.length ? [group("tax_expense", "VI. Tax expense", p.tax)] : [])],
    totalRevenueMinor: s(totalRev), totalExpensesMinor: s(totalExp), profitBeforeTaxMinor: s(pbt), taxExpenseMinor: s(tax), profitAfterTaxMinor: s(pat),
    result: pat >= 0n ? "profit" : "loss",
  };
}

export type TradingAccount = {
  salesMinor: string; directExpenses: StGroup; grossProfitMinor: string; result: "gross_profit" | "gross_loss"; groups: StGroup[];
};
/** Trading Account: sales less direct expenses (the configured purchase / consumption heads) = gross profit, carried to the P&L. */
export function tradingAccount(cs: Cl[], cfg: PresentationConfig): TradingAccount {
  const p = plParts(cs, cfg);
  const sales = group("sales", "Sales / receipts from operations", p.revenue), direct = group("direct_expenses", "Purchases and direct expenses", p.direct);
  const gp = BigInt(sales.totalMinor) - BigInt(direct.totalMinor);
  return { salesMinor: sales.totalMinor, directExpenses: direct, grossProfitMinor: s(gp), result: gp >= 0n ? "gross_profit" : "gross_loss", groups: [sales, direct] };
}

export type TradingPl = {
  grossProfitMinor: string; groups: StGroup[]; indirectExpensesMinor: string; netProfitMinor: string; result: "net_profit" | "net_loss";
};
/** Profit & Loss Account (ITR shape): gross profit b/d + other income - indirect expenses (all expense heads not in the Trading Account). */
export function tradingProfitAndLoss(cs: Cl[], cfg: PresentationConfig): TradingPl {
  const p = plParts(cs, cfg), ta = tradingAccount(cs, cfg);
  const other = group("other_income", "Other income", p.otherIncome);
  const indirect = [
    group("employee_benefits", "Salaries, wages and employee costs", p.employee), group("finance_costs", "Interest and finance charges", p.finance),
    group("depreciation", "Depreciation", p.depreciation), group("other_expenses", "Other indirect expenses", p.otherExp),
    ...(p.tax.length ? [group("tax_expense", "Provision for tax", p.tax)] : []),
  ];
  const ind = total(indirect), np = BigInt(ta.grossProfitMinor) + BigInt(other.totalMinor) - ind;
  return { grossProfitMinor: ta.grossProfitMinor, groups: [other, ...indirect], indirectExpensesMinor: s(ind), netProfitMinor: s(np), result: np >= 0n ? "net_profit" : "net_loss" };
}

// ---- Balance Sheet ------------------------------------------------------------------------------------------------------

export type BalanceSheet = {
  family: CommercialFamily; equityAndLiabilities: StGroup[]; assets: StGroup[];
  totalEquityAndLiabilitiesMinor: string; totalAssetsMinor: string; priorYearTotalAssetsMinor: string; priorYearTotalEquityAndLiabilitiesMinor: string;
  balanced: boolean; differenceMinor: string; surplusForYearMinor: string;
};

/** Schedule III / ITR Balance Sheet from the stored classes. The year's surplus (income - expense) joins reserves and surplus / the capital account. */
export function balanceSheet(cs: Cl[], cfg: PresentationConfig, family: CommercialFamily): BalanceSheet {
  const surplus = t(cs.filter((c) => c.nature === "income")) - t(cs.filter((c) => c.nature === "expense"));
  const eq = cs.filter((c) => c.nature === "equity");
  const isFund = (c: Cl) => c.code === cfg.accumulatedFund;
  const capital = eq.filter((c) => c.statementClass === "equity" && !isFund(c));
  const reserves = eq.filter((c) => c.statementClass !== "equity" || isFund(c));
  const surplusLine: StLine = { code: null, name: "Surplus / (deficit) for the year", amountMinor: s(surplus), priorYearMinor: "0" };
  const liab = cs.filter((c) => c.nature === "liability");
  const nonCurrent = liab.filter((c) => c.statementClass === "non_current_liability");
  const current = liab.filter((c) => c.statementClass !== "non_current_liability");
  const assets = cs.filter((c) => c.nature === "asset");
  const ppe = assets.filter((c) => cfg.fixedAssetCodes.has(c.code) || cfg.accumDepCodes.has(c.code));
  const currentAssets = assets.filter((c) => !ppe.includes(c));
  const sched = family === "schedule_iii";
  const ppeNet = ppe.reduce((a, c) => a + c.natural, 0n), ppeNetPrior = ppe.reduce((a, c) => a + c.naturalOpening, 0n);
  const ppeGroup: StGroup = { key: "fixed_assets", label: sched ? "Non-current assets: Property, plant and equipment (net)" : "Fixed assets (net block)", lines: ppe.map((c) => lineOf(c, true)), totalMinor: s(ppeNet), priorYearTotalMinor: s(ppeNetPrior) };
  const el: StGroup[] = [
    group("capital", sched ? "Shareholders' funds: Share capital" : "Proprietor's / partners' capital account", capital, true),
    group("reserves", sched ? "Shareholders' funds: Reserves and surplus" : "Reserves and surplus (incl. profit for the year)", reserves, true, [surplusLine]),
    group("non_current_liabilities", sched ? "Non-current liabilities" : "Long-term liabilities", nonCurrent, true),
    group("current_liabilities", sched ? "Current liabilities" : "Current liabilities and provisions", current, true),
  ];
  const as: StGroup[] = [ppeGroup, group("current_assets", sched ? "Current assets" : "Current assets, loans and advances", currentAssets, true)];
  const tel = total(el), ta = total(as);
  return {
    family, equityAndLiabilities: el, assets: as,
    totalEquityAndLiabilitiesMinor: s(tel), totalAssetsMinor: s(ta), priorYearTotalEquityAndLiabilitiesMinor: s(priorTotal(el)), priorYearTotalAssetsMinor: s(priorTotal(as)),
    balanced: tel === ta, differenceMinor: s(ta - tel), surplusForYearMinor: s(surplus),
  };
}

// ---- Cash Flow (indirect, AS 3) -----------------------------------------------------------------------------------------

export type CashFlow = {
  profitBeforeTaxMinor: string;
  operating: StGroup; investing: StGroup; financing: StGroup;
  netOperatingMinor: string; netInvestingMinor: string; netFinancingMinor: string; netChangeMinor: string;
  openingCashMinor: string; closingCashMinor: string; reconciles: boolean;
};

/**
 * Indirect-method Cash Flow. Every movement comes from the same classified rows as the Balance Sheet, so it reconciles to the
 * cash heads by construction (`reconciles` is the proof, false only if the ledger itself does not balance).
 * operating = profit + depreciation - change in non-cash current assets + change in current liabilities (excl. borrowings);
 * investing = -(change in net fixed assets + depreciation); financing = change in borrowings, non-current liabilities, capital and reserves.
 */
export function cashFlow(cs: Cl[], cfg: PresentationConfig): CashFlow {
  const profit = t(cs.filter((c) => c.nature === "income")) - t(cs.filter((c) => c.nature === "expense"));
  const dep = t(plParts(cs, cfg).depreciation);
  const delta = (c: Cl) => c.natural - c.naturalOpening;
  const assets = cs.filter((c) => c.nature === "asset");
  const cash = assets.filter((c) => cfg.cashCodes.has(c.code));
  const ppe = assets.filter((c) => cfg.fixedAssetCodes.has(c.code) || cfg.accumDepCodes.has(c.code));
  const wcAssets = assets.filter((c) => !cash.includes(c) && !ppe.includes(c));
  const liab = cs.filter((c) => c.nature === "liability");
  const borrowings = liab.filter((c) => cfg.borrowingCodes.has(c.code) || c.statementClass === "non_current_liability");
  const wcLiab = liab.filter((c) => !borrowings.includes(c));
  const equity = cs.filter((c) => c.nature === "equity");
  const L = (name: string, v: bigint): StLine => ({ code: null, name, amountMinor: s(v) });
  const operating = { key: "operating", label: "A. Cash flow from operating activities", lines: [
    L("Profit for the year", profit), L("Add: depreciation and amortisation", dep),
    L("(Increase) / decrease in current assets (excl. cash)", -wcAssets.reduce((a, c) => a + delta(c), 0n)),
    L("Increase / (decrease) in current liabilities", wcLiab.reduce((a, c) => a + delta(c), 0n)),
  ] } as StGroup;
  const investing = { key: "investing", label: "B. Cash flow from investing activities", lines: [
    L("Purchase of property, plant and equipment (net of disposals)", -(ppe.reduce((a, c) => a + delta(c), 0n) + dep)),
  ] } as StGroup;
  const financing = { key: "financing", label: "C. Cash flow from financing activities", lines: [
    L("Proceeds from / (repayment of) borrowings", borrowings.reduce((a, c) => a + delta(c), 0n)),
    L("Capital introduced / (withdrawn) and movement in reserves", equity.reduce((a, c) => a + delta(c), 0n)),
  ] } as StGroup;
  for (const g of [operating, investing, financing]) g.totalMinor = s(g.lines.reduce((a, l) => a + BigInt(l.amountMinor), 0n));
  const net = BigInt(operating.totalMinor) + BigInt(investing.totalMinor) + BigInt(financing.totalMinor);
  const open = cash.reduce((a, c) => a + c.naturalOpening, 0n), close = cash.reduce((a, c) => a + c.natural, 0n);
  return {
    profitBeforeTaxMinor: s(profit), operating, investing, financing,
    netOperatingMinor: operating.totalMinor, netInvestingMinor: investing.totalMinor, netFinancingMinor: financing.totalMinor, netChangeMinor: s(net),
    openingCashMinor: s(open), closingCashMinor: s(close), reconciles: open + net === close,
  };
}

// ---- the set -------------------------------------------------------------------------------------------------------------

export type CommercialMarkers = { framework: Framework; caVerify: string[]; llpForm8Form11?: "v2" };
export type CommercialSet = {
  family: CommercialFamily; fiscalYear: string; framework: Framework; accountingBasis: string;
  profitAndLoss: ProfitAndLoss | TradingPl; tradingAccount?: TradingAccount; balanceSheet: BalanceSheet; cashFlow?: CashFlow;
  notes: Array<{ ref: string; statement: string; title: string; lines: StLine[]; totalMinor: string }>;
  markers: CommercialMarkers;
};

const CA_VERIFY = [
  "Schedule III line grouping inside each stored statement_class is configurable presentation (CA to confirm)",
  "AS vs Ind AS applicability by threshold is a config toggle; default AS",
  "Presumptive taxation (Sec 44AD / 44ADA) is not built",
  "Profit & Loss comparatives are not produced; the Balance Sheet carries the prior-year column",
];

export function buildCommercialSet(
  rows: ReadonlyArray<CommercialRow>, cfg: PresentationConfig,
  o: { family: CommercialFamily; fy: string; framework: Framework; accountingBasis: string; llp?: boolean },
): CommercialSet {
  const cs = classify(rows);
  const sched = o.family === "schedule_iii";
  const pl = sched ? scheduleIIIProfitAndLoss(cs, cfg) : tradingProfitAndLoss(cs, cfg);
  const bs = balanceSheet(cs, cfg, o.family);
  const notes: CommercialSet["notes"] = [];
  const add = (statement: string, gs: StGroup[]) => gs.filter((g) => g.lines.length > 0).forEach((g) => notes.push({ ref: `N${notes.length + 1}`, statement, title: g.label, lines: g.lines, totalMinor: g.totalMinor }));
  add("profit_and_loss", pl.groups); add("balance_sheet", [...bs.equityAndLiabilities, ...bs.assets]);
  return {
    family: o.family, fiscalYear: o.fy, framework: o.framework, accountingBasis: o.accountingBasis,
    profitAndLoss: pl, ...(sched ? { cashFlow: cashFlow(cs, cfg) } : { tradingAccount: tradingAccount(cs, cfg) }), balanceSheet: bs, notes,
    markers: { framework: o.framework, caVerify: CA_VERIFY, ...(o.llp ? { llpForm8Form11: "v2" as const } : {}) },
  };
}
