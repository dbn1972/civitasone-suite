/**
 * Section 8 NF-7 pure unit tests (no DB): the fund-wise Balance Sheet / Income & Expenditure / Receipts & Payments builders, the
 * inter-fund movement lines, the year-end roll of the inter-fund heads, the pluggable UC rendering, and static guards proving the
 * govt / commercial statement path is untouched. The DB-backed counterpart is tests/nf7-fund-statements-db.test.ts.
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import {
  fundWiseBalanceSheet, fundWiseIncomeExpenditure, fundWiseReceiptsPayments, renderUcLines, ucRenderConfig, UC_NO_CONFIG,
  type FundInfo, type FundMove, type StatementCodes, type StatementInput, type HeadLite, type CashRow,
} from "../src/modules/financial-statements/fund-statements.js";
import { statementSetFor } from "../src/modules/financial-statements/statement-set.js";
import { rollForward, rollInterFundHeads } from "../src/modules/year-end/domain.js";
import { SRC, read, stripComments } from "./_nf0-static.js";

const G: FundInfo = { id: "g", code: "GENERAL", name: "General Fund", type: "unrestricted", fcra: false };
const R: FundInfo = { id: "r", code: "R1", name: "Restricted R1", type: "restricted", fcra: false };
const D: FundInfo = { id: "d", code: "D1", name: "Designated D1", type: "designated", fcra: false };

const CODES: StatementCodes = {
  accumulatedFund: "3100",
  movement: { transferOut: "3910", transferIn: "3911", releaseOut: "3920", releaseIn: "3921" },
  grantLiability: new Set(["2320", "2330", "2340", "2350"]),
  grantIncome: new Set(["4430", "4440", "4450"]),
  grantFund: new Set(["3300"]),
};
const HEADS = new Map<string, HeadLite>([
  ["1100", { name: "Cash and Bank", classification: "asset" }], ["1900", { name: "Due from Other Funds", classification: "asset" }],
  ["2900", { name: "Due to Other Funds", classification: "liability" }], ["2330", { name: "Unutilised Grant-in-Aid - General", classification: "liability" }],
  ["3100", { name: "Accumulated Fund", classification: "equity" }],
  ["3910", { name: "Inter-fund Transfer Out", classification: "equity" }], ["3911", { name: "Inter-fund Transfer In", classification: "equity" }],
  ["3920", { name: "Released from Restriction - Out", classification: "equity" }], ["3921", { name: "Released from Restriction - In", classification: "equity" }],
  ["4100", { name: "Donations", classification: "income" }], ["4440", { name: "Grant-in-Aid Income - General", classification: "income" }],
  ["5100", { name: "Programme Expenses", classification: "expense" }],
]);
const mv = (fundId: string, code: string, dr: bigint, cr: bigint): FundMove => ({ fundId, code, name: HEADS.get(code)?.name ?? null, classification: HEADS.get(code)?.classification ?? null, dr, cr });

/**
 * FY 2026-27, paise-free for readability.
 *   GENERAL: donations 1000 in cash.             transfer GENERAL -> D1 of 200;   release R1 -> GENERAL of 100.
 *   R1:      grant income 600 in cash, spends 150.
 */
const MOVES: FundMove[] = [
  mv("g", "1100", 1000n, 0n), mv("g", "4100", 0n, 1000n),
  mv("r", "1100", 600n, 0n), mv("r", "4440", 0n, 600n), mv("r", "5100", 150n, 0n), mv("r", "1100", 0n, 150n),
  // transfer: source fund Dr transfer-out / Cr due-to; destination Dr due-from / Cr transfer-in
  mv("g", "3910", 200n, 0n), mv("g", "2900", 0n, 200n), mv("d", "1900", 200n, 0n), mv("d", "3911", 0n, 200n),
  // release from restriction: R1 -> GENERAL
  mv("r", "3920", 100n, 0n), mv("r", "2900", 0n, 100n), mv("g", "1900", 100n, 0n), mv("g", "3921", 0n, 100n),
];
const input = (over: Partial<StatementInput> = {}): StatementInput => ({
  fy: "2026-27", funds: [G, R, D], opening: new Map(), movements: MOVES, heads: HEADS, codes: CODES, ...over,
});
const col = <T>(w: { funds: Array<{ fund: { code: string }; statement: T }> }, code: string): T => w.funds.find((f) => f.fund.code === code)!.statement;

describe("fund-wise Balance Sheet", () => {
  const bs = fundWiseBalanceSheet(input());

  it("every fund balances on its own, and so does the all-funds total", () => {
    for (const f of bs.funds) expect(f.statement.balanced, f.fund.code).toBe(true);
    expect(bs.total.balanced).toBe(true);
  });

  it("GENERAL: assets, due-to line, surplus and the inter-fund movement lines add up to its fund balance", () => {
    const s = col(bs, "GENERAL");
    expect(s.totals.totalAssetsMinor).toBe("1100");          // cash 1000 + due-from 100
    expect(s.totals.totalLiabilitiesMinor).toBe("200");      // due-to 200
    expect(s.fundBalance.surplusDeficitMinor).toBe("1000");
    expect(Object.fromEntries(s.fundBalance.fundMovements.map((m) => [m.kind, m.amountMinor]))).toEqual({
      transfer_in: "0", transfer_out: "-200", release_in: "100", release_out: "0",
    });
    expect(s.fundBalance.closingMinor).toBe("900");          // 1000 - 200 + 100
  });

  it("the inter-fund heads render as fund-movement lines, NOT as plain fund-balance lines", () => {
    const s = col(bs, "GENERAL");
    expect(s.fundBalance.lines.map((l) => l.code)).not.toContain("3910");
    expect(s.fundBalance.fundMovements.map((m) => m.code)).toEqual(["3911", "3910", "3921", "3920"]);
    const dueTo = s.liabilities.find((l) => l.code === "2900")!;
    expect(dueTo.amountMinor).toBe("200");
  });

  it("R1 and D1 columns carry the other side of each movement", () => {
    const r = col(bs, "R1"), d = col(bs, "D1");
    expect(r.fundBalance.closingMinor).toBe("350");          // 600 - 150 - 100 released
    expect(r.fundBalance.fundMovements.find((m) => m.kind === "release_out")!.amountMinor).toBe("-100");
    expect(d.fundBalance.closingMinor).toBe("200");
    expect(d.fundBalance.fundMovements.find((m) => m.kind === "transfer_in")!.amountMinor).toBe("200");
  });

  it("the total column is the sum of the funds, and inter-fund movements cancel in total", () => {
    expect(bs.total.fundBalance.closingMinor).toBe("1450");  // 900 + 350 + 200
    const net = bs.total.fundBalance.fundMovements.reduce((s, m) => s + BigInt(m.amountMinor), 0n);
    expect(net).toBe(0n);
    expect(bs.total.totals.totalAssetsMinor).toBe("1750");
  });

  it("groups funds by type (corpus / restricted / designated / unrestricted order) with one aggregated column each", () => {
    expect(bs.funds.map((f) => f.fund.code)).toEqual(["R1", "D1", "GENERAL"]);
    expect(bs.byType.map((t) => t.type)).toEqual(["restricted", "designated", "unrestricted"]);
  });

  it("an unreleased unutilised grant is a grants_in_aid liability line", () => {
    const withGrant = fundWiseBalanceSheet(input({ movements: [...MOVES, mv("r", "1100", 50n, 0n), mv("r", "2330", 0n, 50n)] }));
    const l = col(withGrant, "R1").liabilities.find((x) => x.code === "2330")!;
    expect(l.group).toBe("grants_in_aid");
    expect(withGrant.total.balanced).toBe(true);
  });

  it("opening balances (year-end rolled) feed the fund balance; movement heads open at zero", () => {
    const opening = new Map([["g", new Map([["1100", 900n], ["3100", -900n]])]]);
    const next = fundWiseBalanceSheet(input({ fy: "2027-28", funds: [G], opening, movements: [] }));
    const s = col(next, "GENERAL");
    expect(s.fundBalance.closingMinor).toBe("900");
    expect(s.fundBalance.lines.map((l) => l.code)).toEqual(["3100"]);
    expect(s.fundBalance.fundMovements.every((m) => m.amountMinor === "0")).toBe(true);
    expect(s.balanced).toBe(true);
  });
});

describe("fund-wise Income & Expenditure", () => {
  const ie = fundWiseIncomeExpenditure(input());
  it("splits income / expenditure per fund and tags NF-3 grant income as grants_in_aid", () => {
    const r = col(ie, "R1");
    expect(r.totalIncomeMinor).toBe("600");
    expect(r.totalExpenditureMinor).toBe("150");
    expect(r.income[0]!.group).toBe("grants_in_aid");
    expect(r.surplusBeforeTransfersMinor).toBe("450");
  });
  it("renders the transfer / release heads as fund-movement lines and carries the surplus after transfers", () => {
    const g = col(ie, "GENERAL");
    expect(g.fundMovements.map((m) => [m.kind, m.amountMinor])).toEqual([["transfer_in", "0"], ["transfer_out", "-200"], ["release_in", "100"], ["release_out", "0"]]);
    expect(g.netFundMovementMinor).toBe("-100");
    expect(g.surplusAfterTransfersMinor).toBe("900");
    expect(col(ie, "R1").surplusAfterTransfersMinor).toBe("350");
  });
  it("in total the surplus before and after transfers agree (movements cancel) and equal the sum of the funds", () => {
    expect(ie.total.netFundMovementMinor).toBe("0");
    expect(ie.total.surplusBeforeTransfersMinor).toBe("1450");
    expect(ie.total.surplusAfterTransfersMinor).toBe("1450");
    expect(ie.total.result).toBe("surplus");
  });
  it("the Balance Sheet surplus equals the I&E surplus before transfers for every fund (the two statements agree)", () => {
    const bs = fundWiseBalanceSheet(input());
    for (const f of ie.funds) expect(col(bs, f.fund.code).fundBalance.surplusDeficitMinor).toBe(f.statement.surplusBeforeTransfersMinor);
  });
  it("a deficit is reported as a deficit", () => {
    const d = fundWiseIncomeExpenditure(input({ funds: [G], movements: [mv("g", "5100", 300n, 0n), mv("g", "1100", 0n, 300n)] }));
    expect(d.total.result).toBe("deficit");
  });
});

describe("year-end roll of the inter-fund heads (domain)", () => {
  const codes = ["3910", "3911", "3920", "3921"];
  it("folds the four movement heads into the accumulated fund and drops them", () => {
    const out = rollInterFundHeads(new Map([["1100", 500n], ["3910", 200n], ["3911", -50n], ["3920", 10n], ["3921", -10n], ["3100", -650n]]), codes, "3100");
    expect([...out.keys()].sort()).toEqual(["1100", "3100"]);
    expect(out.get("3100")).toBe(-650n + 200n - 50n + 10n - 10n);
  });
  it("preserves the fund total, does not mutate its input, is idempotent, and drops zero balances", () => {
    const base = new Map([["1100", 500n], ["3910", 100n], ["3911", -100n], ["3100", -500n]]);
    const total = (m: ReadonlyMap<string, bigint>) => [...m.values()].reduce((s, v) => s + v, 0n);
    const once = rollInterFundHeads(base, codes, "3100");
    expect(base.get("3910")).toBe(100n);
    expect(total(once)).toBe(total(base));
    expect(rollInterFundHeads(once, codes, "3100")).toEqual(once);
    expect(once.has("3100")).toBe(true);
    const zero = rollInterFundHeads(new Map([["3910", 100n], ["3100", -100n]]), codes, "3100");
    expect(zero.size).toBe(0);
  });
  it("composes with rollForward: a year that only moved value between funds opens the next year with no 39xx head", () => {
    const classify = (c: string) => ({ classification: HEADS.get(c)?.classification ?? null });
    const gMoves = MOVES.filter((m) => m.fundId === "g").map((m) => ({ code: m.code, name: m.name, classification: m.classification, dr: m.dr, cr: m.cr }));
    const carried = rollInterFundHeads(rollForward(new Map(), gMoves, classify, "3100"), codes, "3100");
    expect([...carried.keys()].some((k) => codes.includes(k))).toBe(false);
    expect(carried.get("3100")).toBe(-900n);   // 1000 income - 200 out + 100 in, credit-signed
    expect([...carried.values()].reduce((s, v) => s + v, 0n)).toBe(0n);
  });
  it("a head named like the fund code itself is left alone", () => {
    expect(rollInterFundHeads(new Map([["3910", 5n]]), ["3910"], "3910").get("3910")).toBe(5n);
  });
});

describe("fund-wise Receipts & Payments", () => {
  const rows: CashRow[] = [
    { fundId: "g", bankOrCash: "bank", headCode: null, headName: null, openingMinor: 400n, receiptMinor: 0n, paymentMinor: 0n },
    { fundId: "g", bankOrCash: "bank", headCode: "4100", headName: "Donations", openingMinor: 0n, receiptMinor: 1000n, paymentMinor: 0n },
    { fundId: "g", bankOrCash: "cash", headCode: "5100", headName: "Programme Expenses", openingMinor: 0n, receiptMinor: 0n, paymentMinor: 30n },
    { fundId: "r", bankOrCash: "bank", headCode: "4440", headName: "Grant-in-Aid Income - General", openingMinor: 0n, receiptMinor: 600n, paymentMinor: 0n },
    { fundId: "r", bankOrCash: "bank", headCode: "5100", headName: "Programme Expenses", openingMinor: 0n, receiptMinor: 0n, paymentMinor: 150n },
  ];
  const rp = fundWiseReceiptsPayments([G, R, D], rows, CODES);
  it("opening + receipts - payments = closing, per fund and in total", () => {
    const g = col(rp, "GENERAL");
    expect(g.openingTotalMinor).toBe("400");
    expect(g.totalReceiptsMinor).toBe("1000");
    expect(g.totalPaymentsMinor).toBe("30");
    expect(g.closingTotalMinor).toBe("1370");
    expect(rp.total.closingTotalMinor).toBe(String(1370 + 450));
    expect(g.closingBalances).toEqual([{ bankOrCash: "bank", amountMinor: "1400" }, { bankOrCash: "cash", amountMinor: "-30" }]);
  });
  it("tags grant receipts as grants_in_aid and keeps an untagged opening out of the receipt lines", () => {
    expect(col(rp, "R1").receipts[0]!.group).toBe("grants_in_aid");
    expect(col(rp, "GENERAL").receipts.map((r) => r.headCode)).toEqual(["4100"]);
  });
  it("a fund with no cash activity renders empty, not missing", () => {
    expect(col(rp, "D1").totalReceiptsMinor).toBe("0");
  });
});

describe("Utilisation Certificate rendering is pluggable and nullable", () => {
  const fact = { grantId: "g1", fundId: "r", grantor: "Dept", sanctionRef: "S-1", category: "general", sanctionedMinor: 1000n, receivedMinor: 600n, utilisedMinor: 400n, unspentMinor: 200n, interestEarnedMinor: 7n, ucForm: null, interestTreatment: null, ucSubmittedDate: null } as const;
  it("with no value recorded and no config, the UC form and interest treatment are null (the CA input is pending)", () => {
    const [l] = renderUcLines([fact], UC_NO_CONFIG);
    expect(l!.ucForm).toBeNull(); expect(l!.ucFormSource).toBeNull();
    expect(l!.interestTreatment).toBeNull(); expect(l!.interestTreatmentSource).toBeNull();
    expect(l!.unspentMinor).toBe("200");
  });
  it("a configured default fills the gap, and a recorded value always wins -- both are data / config changes, not code", () => {
    const cfg = ucRenderConfig({ FINANCE_UC_FORM_DEFAULT: "GFR 12-A", FINANCE_UC_INTEREST_TREATMENT_DEFAULT: "remit" });
    const [d] = renderUcLines([fact], cfg);
    expect(d).toMatchObject({ ucForm: "GFR 12-A", ucFormSource: "default", interestTreatment: "remit", interestTreatmentSource: "default" });
    const [r] = renderUcLines([{ ...fact, ucForm: "GFR 12-C", interestTreatment: "adjust" }], cfg);
    expect(r).toMatchObject({ ucForm: "GFR 12-C", ucFormSource: "recorded", interestTreatment: "adjust", interestTreatmentSource: "recorded" });
  });
  it("a malformed interest-treatment default is ignored, a blank form default is null", () => {
    expect(ucRenderConfig({ FINANCE_UC_INTEREST_TREATMENT_DEFAULT: "keep", FINANCE_UC_FORM_DEFAULT: "  " })).toEqual({ defaultForm: null, defaultInterestTreatment: null });
  });
});

describe("govt / commercial statement path is untouched (static guards)", () => {
  const code = (rel: string) => stripComments(read(join(SRC, rel)));
  it("routes.ts (govt / commercial statements) does not import any NF-7 module", () => {
    expect(code("modules/financial-statements/routes.ts")).not.toMatch(/fund-statements|fund-routes|rollInterFundHeads/);
  });
  it("the govt year-end close (year-end/repo.ts) does not reference the inter-fund roll; only the per-fund close does", () => {
    const repo = code("modules/year-end/repo.ts");
    expect(repo).not.toMatch(/rollInterFundHeads|INTER_FUND_MOVEMENT_CODES/);
    expect(repo).toMatch(/fundPath/);
    expect(code("modules/year-end/fund-repo.ts")).toMatch(/rollInterFundHeads/);
  });
  it("every NF-7 route is behind the stored fund_accounting flag (404 FUNDS_NOT_ENABLED)", () => {
    const routes = code("modules/financial-statements/fund-routes.ts");
    expect(routes).toMatch(/loadPostingSettingsTx/);
    expect(routes).toMatch(/FUNDS_NOT_ENABLED/);
    expect((routes.match(/app\.get\(/g) ?? []).length).toBe(6);
    expect(routes).not.toMatch(/app\.(post|put|patch|delete)\(/);
  });
  it("the NF-7 modules never read an edition or the profile catalogue", () => {
    for (const f of ["fund-statements.ts", "fund-statements-repo.ts", "fund-routes.ts"]) {
      expect(code(`modules/financial-statements/${f}`), f).not.toMatch(/\b(getProfile|PROFILES|effectiveSettings|edition)\b/i);
    }
  });
});

describe("statement-set resolver (keyed on the stored chart template)", () => {
  it("govt (and unknown / missing) resolves to the existing routes; nonprofit to the fund-wise set; commercial is reserved", () => {
    for (const t of ["govt", null, undefined, "weird"]) {
      const s = statementSetFor(t);
      expect(s.id).toBe("govt");
      expect(s.statements.map((x) => x.route)).toContain("/v1/finance/statements/balance-sheet");
      expect(s.fundWise).toBe(false);
    }
    const np = statementSetFor("nonprofit");
    expect(np.id).toBe("nonprofit");
    expect(np.statements.every((x) => x.route.includes("/fund-wise/"))).toBe(true);
    expect(np.requiresFundAccounting).toBe(true);
    expect(statementSetFor("commercial")).toMatchObject({ id: "commercial", available: false, statements: [] });
  });
  it("the resolver holds no classifier of its own (govt classification is not duplicated)", () => {
    expect(stripComments(read(join(SRC, "modules/financial-statements/statement-set.ts")))).not.toMatch(/headNatureOf|natureOf|charAt/);
  });
  it("stored statement_class drives the nature when present (a 3xxx head classed as an asset reads as an asset)", () => {
    const heads = new Map(HEADS); heads.set("3300", { name: "Capital Grant Fund", classification: "equity", statementClass: "capital_reserve" });
    const bs = fundWiseBalanceSheet(input({ funds: [G], heads, movements: [mv("g", "1100", 50n, 0n), mv("g", "3300", 0n, 50n)] }));
    expect(col(bs, "GENERAL").fundBalance.lines.find((l) => l.code === "3300")!.group).toBe("grants_in_aid");
    expect(bs.total.balanced).toBe(true);
  });
});
