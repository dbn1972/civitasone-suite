/**
 * Section 8 NF-7 (docs/design/SECTION8-NONPROFIT-FINANCE.md §7): the fund-wise statutory statement set for a nonprofit /
 * Section 8 company -- Balance Sheet, Income & Expenditure and Receipts & Payments, each as one column per fund plus an
 * all-funds total -- rendering the NF-1 fund dimension, the NF-3 grants-in-aid heads and the inter-fund movement heads.
 *
 * PURE: no database, no clock, no environment (the head codes are passed in). The data loaders live in
 * fund-statements-repo.ts; the routes (fund-routes.ts) answer 404 FUNDS_NOT_ENABLED unless gl.finance_settings.fund_accounting
 * is ON, and the govt / commercial statement routes (routes.ts) are NOT touched by this module at all.
 *
 * Conventions: amounts are signed paise (bigint) inside, decimal strings on the way out (`...Minor`). A head's balance is
 * debit-positive inside a HeadRow (closing = opening + dr - cr); the rendered lines are in the natural sign of the head
 * (asset / expense = debit-positive, liability / equity / income = credit-positive).
 *
 * The 'group' tag on a line is pure presentation: 'grants_in_aid' (NF-3 heads), 'fund_movement' (inter-fund heads) or 'general'.
 * It never changes an amount. Nothing here branches on an edition or a tenant-type string (NF-0 lint).
 */
import { headNatureOf, type HeadNature } from "../../shared/head-nature.js";
import { isCarryForwardHead } from "../year-end/domain.js";

export type FundType = "corpus" | "restricted" | "unrestricted" | "designated";
export const FUND_TYPE_ORDER: readonly FundType[] = ["corpus", "restricted", "designated", "unrestricted"];

export type FundInfo = { id: string; code: string; name: string; type: FundType; fcra: boolean };
export type HeadLite = { name: string | null; classification: string | null; statementClass?: string | null };
export type FundMove = { fundId: string; code: string; name: string | null; classification: string | null; dr: bigint; cr: bigint };

/** The head codes the statements treat specially. Built by `statementCodes()` in fund-statements-repo.ts from system-heads. */
export type StatementCodes = {
  accumulatedFund: string;
  movement: { transferOut: string; transferIn: string; releaseOut: string; releaseIn: string };
  grantLiability: ReadonlySet<string>; // NF-3 unutilised-grant / deferred-grant liabilities
  grantIncome: ReadonlySet<string>;    // NF-3 grant-in-aid income recognised on utilisation / release
  grantFund: ReadonlySet<string>;      // NF-3 Capital Grant Fund (capital_fund policy)
};

export type LineGroup = "grants_in_aid" | "fund_movement" | "general";
export type Line = { code: string; name: string; classification: string | null; group: LineGroup; openingMinor: string; amountMinor: string };

export type MovementKind = "transfer_in" | "transfer_out" | "release_in" | "release_out";
export type MovementLine = { kind: MovementKind; code: string; name: string; amountMinor: string };

export type BalanceSheet = {
  assets: Line[]; liabilities: Line[];
  fundBalance: { lines: Line[]; fundMovements: MovementLine[]; surplusDeficitMinor: string; closingMinor: string };
  totals: { totalAssetsMinor: string; totalLiabilitiesMinor: string; totalFundsAndLiabilitiesMinor: string };
  balanced: boolean; differenceMinor: string;
};
export type IncomeExpenditure = {
  income: Line[]; expenditure: Line[];
  totalIncomeMinor: string; totalExpenditureMinor: string;
  surplusBeforeTransfersMinor: string;
  fundMovements: MovementLine[]; netFundMovementMinor: string;
  surplusAfterTransfersMinor: string; result: "surplus" | "deficit";
};
export type FundColumn<T> = { fund: Pick<FundInfo, "id" | "code" | "name" | "type" | "fcra">; statement: T };
export type TypeColumn<T> = { type: FundType; fundCodes: string[]; statement: T };
export type FundWise<T> = { funds: FundColumn<T>[]; byType: TypeColumn<T>[]; total: T };

// ---- per-head rows ------------------------------------------------------------------------------------------------------

/** Stored budget.finance_heads.statement_class (migration 0169) -> accounting nature. Unknown / absent => fall back to head-nature. */
const NATURE_OF_CLASS: Readonly<Record<string, HeadNature>> = {
  asset: "asset", current_liability: "liability", non_current_liability: "liability", dividend_payable: "liability",
  equity: "equity", reserve: "equity", capital_reserve: "equity", govt_equity: "equity", income: "income", expense: "expense",
};

export type HeadRow = {
  code: string; name: string; classification: string | null; nature: HeadNature; carryForward: boolean;
  opening: bigint; dr: bigint; cr: bigint; closing: bigint;
};
export type Part = { opening: ReadonlyMap<string, bigint>; moves: ReadonlyArray<FundMove> };

const nameOf = (code: string, heads: ReadonlyMap<string, HeadLite>, fallback: string | null, accumulatedFund: string): string =>
  heads.get(code)?.name ?? fallback ?? (code === accumulatedFund ? "Accumulated Fund (surplus brought forward)" : code);

function headRows(part: Part, heads: ReadonlyMap<string, HeadLite>, codes: StatementCodes): HeadRow[] {
  const byCode = new Map<string, { dr: bigint; cr: bigint; name: string | null; cls: string | null }>();
  for (const m of part.moves) {
    const e = byCode.get(m.code) ?? { dr: 0n, cr: 0n, name: m.name, cls: m.classification };
    e.dr += m.dr; e.cr += m.cr; byCode.set(m.code, e);
  }
  const all = [...new Set([...part.opening.keys(), ...byCode.keys()])].sort();
  return all.map((code) => {
    const e = byCode.get(code);
    const classification = heads.get(code)?.classification ?? e?.cls ?? (code === codes.accumulatedFund ? "equity" : null);
    const stored = heads.get(code)?.statementClass;
    const nature: HeadNature = code === codes.accumulatedFund ? "equity" : ((stored ? NATURE_OF_CLASS[stored] : undefined) ?? headNatureOf(code, classification));
    const opening = part.opening.get(code) ?? 0n; const dr = e?.dr ?? 0n; const cr = e?.cr ?? 0n;
    return {
      code, name: nameOf(code, heads, e?.name ?? null, codes.accumulatedFund), classification, nature,
      carryForward: code === codes.accumulatedFund || isCarryForwardHead(code, classification),
      opening, dr, cr, closing: opening + dr - cr,
    };
  });
}

const groupOf = (code: string, codes: StatementCodes): LineGroup => {
  const m = codes.movement;
  if (code === m.transferIn || code === m.transferOut || code === m.releaseIn || code === m.releaseOut) return "fund_movement";
  if (codes.grantLiability.has(code) || codes.grantIncome.has(code) || codes.grantFund.has(code)) return "grants_in_aid";
  return "general";
};

const line = (r: HeadRow, codes: StatementCodes, opening: bigint, amount: bigint): Line => ({
  code: r.code, name: r.name, classification: r.classification, group: groupOf(r.code, codes),
  openingMinor: opening.toString(), amountMinor: amount.toString(),
});

const MOVEMENT_KINDS = (c: StatementCodes): Array<[MovementKind, string]> => [
  ["transfer_in", c.movement.transferIn], ["transfer_out", c.movement.transferOut],
  ["release_in", c.movement.releaseIn], ["release_out", c.movement.releaseOut],
];

// ---- Balance Sheet ------------------------------------------------------------------------------------------------------

/**
 * One column of the Balance Sheet. Assets and liabilities are the carry-forward heads' closing balances; the fund side is the
 * equity heads (credit-positive) + the year's inter-fund movement lines + the year's surplus / deficit (income - expenditure).
 * A fund balances on its own: assets - liabilities = fund balance (due-to / due-from sit on the two sides and cancel in total).
 */
export function balanceSheetOf(rows: ReadonlyArray<HeadRow>, heads: ReadonlyMap<string, HeadLite>, codes: StatementCodes): BalanceSheet {
  const assets: Line[] = [], liabilities: Line[] = [], fundLines: Line[] = [];
  let totalAssets = 0n, totalLiabilities = 0n, equity = 0n, income = 0n, expense = 0n;
  const moveCodes = new Set(MOVEMENT_KINDS(codes).map(([, c]) => c));
  const movementNet = new Map<string, bigint>();
  for (const r of rows) {
    if (moveCodes.has(r.code)) { movementNet.set(r.code, -r.closing); continue; }
    if (r.carryForward && (r.nature === "income" || r.nature === "expense")) {
      // a carry-forward head of income / expense nature (advance / deposit / suspense) is a balance-sheet item by its sign
      if (r.closing > 0n) { assets.push(line(r, codes, r.opening, r.closing)); totalAssets += r.closing; }
      else if (r.closing < 0n) { liabilities.push(line(r, codes, -r.opening, -r.closing)); totalLiabilities += -r.closing; }
      continue;
    }
    if (r.nature === "asset") { if (r.closing !== 0n) assets.push(line(r, codes, r.opening, r.closing)); totalAssets += r.closing; }
    else if (r.nature === "liability") { if (r.closing !== 0n) liabilities.push(line(r, codes, -r.opening, -r.closing)); totalLiabilities += -r.closing; }
    else if (r.nature === "equity") { if (r.closing !== 0n) fundLines.push(line(r, codes, -r.opening, -r.closing)); equity += -r.closing; }
    else if (r.nature === "income") income += r.cr - r.dr;
    else expense += r.dr - r.cr;
  }
  const surplus = income - expense;
  const fundMovements: MovementLine[] = MOVEMENT_KINDS(codes).map(([kind, code]) => ({
    kind, code, name: heads.get(code)?.name ?? code, amountMinor: (movementNet.get(code) ?? 0n).toString(),
  }));
  const movementTotal = [...movementNet.values()].reduce((s, v) => s + v, 0n);
  const fundClosing = equity + movementTotal + surplus;
  const liabAndFunds = totalLiabilities + fundClosing;
  return {
    assets, liabilities,
    fundBalance: { lines: fundLines, fundMovements, surplusDeficitMinor: surplus.toString(), closingMinor: fundClosing.toString() },
    totals: { totalAssetsMinor: totalAssets.toString(), totalLiabilitiesMinor: totalLiabilities.toString(), totalFundsAndLiabilitiesMinor: liabAndFunds.toString() },
    balanced: totalAssets === liabAndFunds, differenceMinor: (totalAssets - liabAndFunds).toString(),
  };
}

// ---- Income & Expenditure -----------------------------------------------------------------------------------------------

/**
 * One column of the Income & Expenditure account (= Statement of Profit & Loss). Flow statement: this year's movements only.
 * The surplus before transfers is income - expenditure; the inter-fund transfer / release lines then show what moved between
 * funds, giving the surplus carried to the fund. In the all-funds total the transfers cancel to zero.
 */
export function incomeExpenditureOf(rows: ReadonlyArray<HeadRow>, heads: ReadonlyMap<string, HeadLite>, codes: StatementCodes): IncomeExpenditure {
  const income: Line[] = [], expenditure: Line[] = [];
  let ti = 0n, te = 0n;
  for (const r of rows) {
    if (r.carryForward) continue; // advance / deposit / suspense stay on the Balance Sheet (same rule as balanceSheetOf)
    if (r.nature === "income") { const v = r.cr - r.dr; if (r.dr !== 0n || r.cr !== 0n) income.push(line(r, codes, 0n, v)); ti += v; }
    else if (r.nature === "expense") { const v = r.dr - r.cr; if (r.dr !== 0n || r.cr !== 0n) expenditure.push(line(r, codes, 0n, v)); te += v; }
  }
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const fundMovements: MovementLine[] = MOVEMENT_KINDS(codes).map(([kind, code]) => {
    const r = byCode.get(code);
    return { kind, code, name: heads.get(code)?.name ?? code, amountMinor: (r ? r.cr - r.dr : 0n).toString() };
  });
  const net = fundMovements.reduce((s, m) => s + BigInt(m.amountMinor), 0n);
  const before = ti - te;
  return {
    income, expenditure, totalIncomeMinor: ti.toString(), totalExpenditureMinor: te.toString(),
    surplusBeforeTransfersMinor: before.toString(), fundMovements, netFundMovementMinor: net.toString(),
    surplusAfterTransfersMinor: (before + net).toString(), result: before + net >= 0n ? "surplus" : "deficit",
  };
}

// ---- fund-wise assembly -------------------------------------------------------------------------------------------------

export type StatementInput = {
  fy: string;
  funds: ReadonlyArray<FundInfo>;
  opening: ReadonlyMap<string, ReadonlyMap<string, bigint>>; // fundId -> head code -> signed (carry-forward only; year-end rolled)
  movements: ReadonlyArray<FundMove>;                        // this FY, per fund
  heads: ReadonlyMap<string, HeadLite>;
  codes: StatementCodes;
};

const mergeParts = (parts: ReadonlyArray<Part>): Part => {
  const opening = new Map<string, bigint>();
  const moves: FundMove[] = [];
  for (const p of parts) {
    for (const [c, v] of p.opening) opening.set(c, (opening.get(c) ?? 0n) + v);
    moves.push(...p.moves);
  }
  return { opening, moves };
};

const sortedFunds = (funds: ReadonlyArray<FundInfo>): FundInfo[] =>
  [...funds].sort((a, b) => FUND_TYPE_ORDER.indexOf(a.type) - FUND_TYPE_ORDER.indexOf(b.type) || a.code.localeCompare(b.code));

function fundWise<T>(i: StatementInput, render: (rows: HeadRow[]) => T): FundWise<T> {
  const partOf = (f: FundInfo): Part => ({ opening: i.opening.get(f.id) ?? new Map(), moves: i.movements.filter((m) => m.fundId === f.id) });
  const funds = sortedFunds(i.funds);
  const parts = new Map(funds.map((f) => [f.id, partOf(f)]));
  const rowsOf = (p: Part) => headRows(p, i.heads, i.codes);
  const pick = (f: FundInfo): FundInfo["type"] => f.type;
  const byType: TypeColumn<T>[] = FUND_TYPE_ORDER.flatMap((type) => {
    const inType = funds.filter((f) => pick(f) === type);
    if (inType.length === 0) return [];
    return [{ type, fundCodes: inType.map((f) => f.code), statement: render(rowsOf(mergeParts(inType.map((f) => parts.get(f.id) as Part)))) }];
  });
  return {
    funds: funds.map((f) => ({ fund: { id: f.id, code: f.code, name: f.name, type: f.type, fcra: f.fcra }, statement: render(rowsOf(parts.get(f.id) as Part)) })),
    byType,
    total: render(rowsOf(mergeParts(funds.map((f) => parts.get(f.id) as Part)))),
  };
}

export const fundWiseBalanceSheet = (i: StatementInput): FundWise<BalanceSheet> => fundWise(i, (rows) => balanceSheetOf(rows, i.heads, i.codes));
export const fundWiseIncomeExpenditure = (i: StatementInput): FundWise<IncomeExpenditure> => fundWise(i, (rows) => incomeExpenditureOf(rows, i.heads, i.codes));

// ---- Receipts & Payments ------------------------------------------------------------------------------------------------

/** One cash-book aggregate: fund x bank-or-cash x tagged head, with the opening slice (before the FY) and the FY flows. */
export type CashRow = {
  fundId: string; bankOrCash: string; headCode: string | null; headName: string | null;
  openingMinor: bigint; receiptMinor: bigint; paymentMinor: bigint;
};
export type ReceiptsPayments = {
  openingBalances: Array<{ bankOrCash: string; amountMinor: string }>;
  receipts: Array<{ headCode: string | null; headName: string; group: LineGroup; amountMinor: string }>;
  payments: Array<{ headCode: string | null; headName: string; group: LineGroup; amountMinor: string }>;
  closingBalances: Array<{ bankOrCash: string; amountMinor: string }>;
  totalReceiptsMinor: string; totalPaymentsMinor: string; openingTotalMinor: string; closingTotalMinor: string;
};

const UNCLASSIFIED = "Unclassified (no head tagged)";

export function receiptsPaymentsOf(rows: ReadonlyArray<CashRow>, codes: StatementCodes): ReceiptsPayments {
  const open = new Map<string, bigint>(), close = new Map<string, bigint>();
  const rec = new Map<string, { code: string | null; name: string; v: bigint }>(), pay = new Map<string, { code: string | null; name: string; v: bigint }>();
  const bump = (m: Map<string, { code: string | null; name: string; v: bigint }>, r: CashRow, v: bigint) => {
    if (v === 0n) return;
    const k = r.headCode ?? "";
    const e = m.get(k) ?? { code: r.headCode, name: r.headName ?? (r.headCode ?? UNCLASSIFIED), v: 0n };
    e.v += v; m.set(k, e);
  };
  for (const r of rows) {
    open.set(r.bankOrCash, (open.get(r.bankOrCash) ?? 0n) + r.openingMinor);
    close.set(r.bankOrCash, (close.get(r.bankOrCash) ?? 0n) + r.openingMinor + r.receiptMinor - r.paymentMinor);
    bump(rec, r, r.receiptMinor); bump(pay, r, r.paymentMinor);
  }
  const accounts = (m: Map<string, bigint>) => [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([bankOrCash, v]) => ({ bankOrCash, amountMinor: v.toString() }));
  const lines = (m: Map<string, { code: string | null; name: string; v: bigint }>) =>
    [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, e]) => ({ headCode: e.code, headName: e.name, group: e.code ? groupOf(e.code, codes) : ("general" as LineGroup), amountMinor: e.v.toString() }));
  const sum = (m: Map<string, { v: bigint }>) => [...m.values()].reduce((s, e) => s + e.v, 0n);
  const sumB = (m: Map<string, bigint>) => [...m.values()].reduce((s, v) => s + v, 0n);
  return {
    openingBalances: accounts(open), receipts: lines(rec), payments: lines(pay), closingBalances: accounts(close),
    totalReceiptsMinor: sum(rec).toString(), totalPaymentsMinor: sum(pay).toString(),
    openingTotalMinor: sumB(open).toString(), closingTotalMinor: sumB(close).toString(),
  };
}

export function fundWiseReceiptsPayments(funds: ReadonlyArray<FundInfo>, rows: ReadonlyArray<CashRow>, codes: StatementCodes): FundWise<ReceiptsPayments> {
  const sorted = sortedFunds(funds);
  const forFunds = (ids: Set<string>) => receiptsPaymentsOf(rows.filter((r) => ids.has(r.fundId)), codes);
  return {
    funds: sorted.map((f) => ({ fund: { id: f.id, code: f.code, name: f.name, type: f.type, fcra: f.fcra }, statement: forFunds(new Set([f.id])) })),
    byType: FUND_TYPE_ORDER.flatMap((type) => {
      const inType = sorted.filter((f) => f.type === type);
      return inType.length === 0 ? [] : [{ type, fundCodes: inType.map((f) => f.code), statement: forFunds(new Set(inType.map((f) => f.id))) }];
    }),
    total: forFunds(new Set(sorted.map((f) => f.id))),
  };
}

// ---- Utilisation Certificate rendering (PLUGGABLE / NULLABLE) -----------------------------------------------------------

export type InterestTreatment = "remit" | "adjust" | "retain";
/**
 * The GFR UC form number and the interest-on-grant treatment are a pending CA input. They are rendered from DATA: the row's
 * own recorded value wins, then the configured default, else null. Supplying them later is a data change (record the value on
 * the utilisation row) or a config change (FINANCE_UC_FORM_DEFAULT / FINANCE_UC_INTEREST_TREATMENT_DEFAULT) -- no rebuild.
 */
export type UcRenderConfig = { defaultForm: string | null; defaultInterestTreatment: InterestTreatment | null };
export const UC_NO_CONFIG: UcRenderConfig = { defaultForm: null, defaultInterestTreatment: null };

export function ucRenderConfig(env: Record<string, string | undefined> = {}): UcRenderConfig {
  const form = (env.FINANCE_UC_FORM_DEFAULT ?? "").trim();
  const t = (env.FINANCE_UC_INTEREST_TREATMENT_DEFAULT ?? "").trim();
  return { defaultForm: form === "" ? null : form.slice(0, 64), defaultInterestTreatment: t === "remit" || t === "adjust" || t === "retain" ? t : null };
}

export type GrantUtilisationFacts = {
  grantId: string; fundId: string; grantor: string; sanctionRef: string; category: string; sanctionedMinor: bigint;
  receivedMinor: bigint; utilisedMinor: bigint; unspentMinor: bigint; interestEarnedMinor: bigint;
  ucForm: string | null; interestTreatment: InterestTreatment | null; ucSubmittedDate: string | null;
};
export type UcLine = {
  grantId: string; fundId: string; grantor: string; sanctionRef: string; category: string;
  sanctionedMinor: string; receivedMinor: string; utilisedMinor: string; unspentMinor: string; interestEarnedMinor: string;
  ucForm: string | null; ucFormSource: "recorded" | "default" | null;
  interestTreatment: InterestTreatment | null; interestTreatmentSource: "recorded" | "default" | null;
  ucSubmittedDate: string | null;
};

export function renderUcLines(facts: ReadonlyArray<GrantUtilisationFacts>, cfg: UcRenderConfig = UC_NO_CONFIG): UcLine[] {
  return facts.map((g) => ({
    grantId: g.grantId, fundId: g.fundId, grantor: g.grantor, sanctionRef: g.sanctionRef, category: g.category,
    sanctionedMinor: g.sanctionedMinor.toString(), receivedMinor: g.receivedMinor.toString(), utilisedMinor: g.utilisedMinor.toString(),
    unspentMinor: g.unspentMinor.toString(), interestEarnedMinor: g.interestEarnedMinor.toString(),
    ucForm: g.ucForm ?? cfg.defaultForm, ucFormSource: g.ucForm ? "recorded" : cfg.defaultForm ? "default" : null,
    interestTreatment: g.interestTreatment ?? cfg.defaultInterestTreatment,
    interestTreatmentSource: g.interestTreatment ? "recorded" : cfg.defaultInterestTreatment ? "default" : null,
    ucSubmittedDate: g.ucSubmittedDate,
  }));
}
