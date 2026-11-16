/**
 * Section 8 NF-1 pure unit tests (no DB): the fund seam, the per-fund balancing and spend rules, the inter-fund journal
 * shapes, the opening-balance fund rules and the single settings read. The DB-backed counterpart is tests/nf1-fund-db.test.ts.
 */
import { describe, it, expect, vi } from "vitest";
import { fundContextFromSettings, fundContextFromFlag } from "../src/modules/gl/fund-context.js";
import {
  assertFundsBalanced, assertFundSpend, fundDeltaMinor, buildInterFundTransfer, buildFundRelease, FUND_HEADS,
  openingEntryConflicts, assertOpeningBalancedPerFund, coalesceFundSql,
} from "../src/modules/gl/funds.js";
import { loadPostingSettingsTx, assertFundPostingReady } from "../src/modules/approvals/posting-settings.js";
import { loadBudgetControlTx } from "../src/modules/budget/provision.js";
import { sql } from "drizzle-orm";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const G = "99999999-0000-4000-8000-000000000009";

describe("fundContext seam: OFF is strict identity", () => {
  it("disabled context returns the SAME row object from every tag*() and has no fund", () => {
    const ctx = fundContextFromSettings({ fundAccounting: false, generalFundId: null });
    const row = { lines: [{ accountCode: "1100" }], x: 1 };
    expect(ctx.enabled).toBe(false);
    expect(ctx.generalFundId).toBeNull();
    expect(ctx.tagJournal(row)).toBe(row);
    expect(ctx.tagJournalLine(row, A)).toBe(row);
    expect(ctx.tagLedgerLine(row, A)).toBe(row);
    expect(ctx.tagOpeningBalance(row, A)).toBe(row);
    expect(ctx.fundOfLine({})).toBeNull();
  });
  it("a line that names a fund while the flag is OFF is refused, never silently dropped", () => {
    const ctx = fundContextFromFlag(false);
    expect(() => ctx.fundOfLine({ fundId: A })).toThrow(/FUND_ACCOUNTING_DISABLED|names a fund/);
  });
  it("NULL / undefined flag are OFF", () => {
    expect(fundContextFromFlag(null).enabled).toBe(false);
    expect(fundContextFromFlag(undefined).enabled).toBe(false);
  });
});

describe("fundContext seam: ON tags every row from ONE source and is fail-closed", () => {
  const ctx = fundContextFromSettings({ fundAccounting: true, generalFundId: G });
  it("fundOfLine: the named fund, else GENERAL", () => {
    expect(ctx.enabled).toBe(true);
    expect(ctx.fundOfLine({ fundId: A })).toBe(A);
    expect(ctx.fundOfLine({})).toBe(G);
    expect(ctx.fundOfLine({ fundId: null })).toBe(G);
  });
  it("tagJournal puts fundId on every JSONB line element; ledger and journal-line rows get the same fund", () => {
    const j = ctx.tagJournal({ id: "j", lines: [{ accountCode: "1100", fundId: A } as { accountCode: string; fundId?: string }, { accountCode: "4100" }] });
    expect(j.lines.map((l) => l.fundId)).toEqual([A, G]);
    expect((ctx.tagLedgerLine({ headId: "h" }, A) as unknown as { fundId: string }).fundId).toBe(A);
    expect((ctx.tagJournalLine({ headId: "h" }, undefined) as unknown as { fundId: string }).fundId).toBe(G);
    expect((ctx.tagOpeningBalance({ accountCode: "1100" }, null) as unknown as { fundId: string }).fundId).toBe(G);
  });
  it("a row with no lines array passes through tagJournal untouched", () => {
    const row = { id: "x" };
    expect(ctx.tagJournal(row)).toBe(row);
  });
  it("ON with no GENERAL fund cannot build a context: FUND_ACCOUNTING_NOT_READY (design contract #5)", () => {
    expect(() => fundContextFromSettings({ fundAccounting: true, generalFundId: null })).toThrow(/FUND_ACCOUNTING_NOT_READY/);
    expect(() => assertFundPostingReady({ budgetControl: "mandatory", fundAccounting: true, generalFundId: null })).toThrow(/GENERAL fund/);
    expect(() => assertFundPostingReady({ budgetControl: "mandatory", fundAccounting: false, generalFundId: null })).not.toThrow();
  });
});

describe("single settings read per posting (S4)", () => {
  const row = { m: "advisory", f: true, g: G };
  const makeTx = (r: unknown[]) => {
    const limit = vi.fn(async () => r);
    const select = vi.fn(() => ({ from: () => ({ where: () => ({ limit }) }) }));
    return { tx: { select }, select };
  };
  it("loadPostingSettingsTx issues ONE select and returns budget control + fund flag + GENERAL id", async () => {
    const { tx, select } = makeTx([row]);
    expect(await loadPostingSettingsTx(tx, "t")).toEqual({ budgetControl: "advisory", fundAccounting: true, generalFundId: G, capitalGrantPolicy: "deferred_income" });
    expect(select).toHaveBeenCalledTimes(1);
  });
  it("no settings row => mandatory budget control, fund accounting OFF", async () => {
    const { tx } = makeTx([]);
    expect(await loadPostingSettingsTx(tx, "t")).toEqual({ budgetControl: "mandatory", fundAccounting: false, generalFundId: null, capitalGrantPolicy: "deferred_income" });
  });
  it("NULL fund_accounting reads OFF", async () => {
    const { tx } = makeTx([{ m: "off", f: null, g: null }]);
    expect((await loadPostingSettingsTx(tx, "t")).fundAccounting).toBe(false);
  });
  it("loadBudgetControlTx given the pre-read settings issues NO select; without them it issues exactly one", async () => {
    const { tx, select } = makeTx([row]);
    const ps = await loadPostingSettingsTx(tx, "t");
    select.mockClear();
    expect(await loadBudgetControlTx(tx, "t", ps)).toBe("advisory");
    expect(select).not.toHaveBeenCalled();
    expect(await loadBudgetControlTx(tx, "t")).toBe("advisory");
    expect(select).toHaveBeenCalledTimes(1);
  });
});

describe("per-fund balancing (design 2.4)", () => {
  it("is a strict no-op when no line carries a fund (govt)", () => {
    expect(() => assertFundsBalanced([{ debitMinor: 100n, creditMinor: 0n, fund: null }, { debitMinor: 0n, creditMinor: 100n, fund: null }])).not.toThrow();
    // even an (impossible-by-construction) one-sided set is ignored: the overall check is gl/domain.ts assertJournalBalances
    expect(() => assertFundsBalanced([{ debitMinor: 100n, creditMinor: 0n, fund: null }])).not.toThrow();
  });
  it("a journal that balances overall but not within a fund is refused JOURNAL_FUND_UNBALANCED", () => {
    expect(() => assertFundsBalanced([
      { debitMinor: 100n, creditMinor: 0n, fund: A }, { debitMinor: 0n, creditMinor: 100n, fund: B },
    ])).toThrow(/JOURNAL_FUND_UNBALANCED/);
  });
  it("a journal that balances within each fund passes", () => {
    expect(() => assertFundsBalanced([
      { debitMinor: 100n, creditMinor: 0n, fund: A }, { debitMinor: 0n, creditMinor: 100n, fund: A },
      { debitMinor: 50n, creditMinor: 0n, fund: B }, { debitMinor: 0n, creditMinor: 50n, fund: B },
    ])).not.toThrow();
  });
});

describe("spend rule", () => {
  it("only income / expense / equity heads count toward a fund balance", () => {
    expect(fundDeltaMinor({ code: "4100", classification: "income" }, 0n, 500n)).toBe(500n);
    expect(fundDeltaMinor({ code: "5100", classification: "expense" }, 200n, 0n)).toBe(-200n);
    expect(fundDeltaMinor({ code: "3100", classification: "equity" }, 0n, 70n)).toBe(70n);
    expect(fundDeltaMinor({ code: "1100", classification: "asset" }, 999n, 0n)).toBe(0n);
    expect(fundDeltaMinor({ code: "2100", classification: "liability" }, 0n, 999n)).toBe(0n);
  });
  it("restricted: cannot exceed the balance; exactly the balance is fine; a credit is always fine", () => {
    const r = { code: "R1", type: "restricted" as const };
    expect(() => assertFundSpend(r, 1000n, -1001n)).toThrow(/FUND_BALANCE_EXCEEDED/);
    expect(() => assertFundSpend(r, 1000n, -1000n)).not.toThrow();
    expect(() => assertFundSpend(r, 0n, 500n)).not.toThrow();
  });
  it("corpus: any net reduction is refused", () => {
    expect(() => assertFundSpend({ code: "C1", type: "corpus" }, 1_000_000n, -1n)).toThrow(/FUND_CORPUS_NOT_SPENDABLE/);
  });
  it("unrestricted / designated may run a deficit", () => {
    expect(() => assertFundSpend({ code: "GENERAL", type: "unrestricted" }, 0n, -5n)).not.toThrow();
    expect(() => assertFundSpend({ code: "D1", type: "designated" }, 0n, -5n)).not.toThrow();
  });
});

describe("inter-fund transfer and release journals", () => {
  const net = (lines: ReturnType<typeof buildInterFundTransfer>, fund?: string) =>
    lines.filter((l) => fund === undefined || l.fundId === fund).reduce((s, l) => s + BigInt(l.debitMinor) - BigInt(l.creditMinor), 0n);
  it("transfer: each fund's side nets to zero, the whole journal nets to zero, due-to / due-from are paired", () => {
    const lines = buildInterFundTransfer({ fromFundId: A, toFundId: B, amountMinor: 12_345n });
    expect(lines).toHaveLength(4);
    expect(net(lines, A)).toBe(0n);
    expect(net(lines, B)).toBe(0n);
    expect(net(lines)).toBe(0n);
    const code = (c: string) => lines.filter((l) => l.accountCode === c);
    expect(code(FUND_HEADS.transferOut)[0]).toMatchObject({ fundId: A, debitMinor: 12_345n });
    expect(code(FUND_HEADS.dueTo)[0]).toMatchObject({ fundId: A, creditMinor: 12_345n });   // the source owes the destination
    expect(code(FUND_HEADS.dueFrom)[0]).toMatchObject({ fundId: B, debitMinor: 12_345n });  // the destination is owed
    expect(code(FUND_HEADS.transferIn)[0]).toMatchObject({ fundId: B, creditMinor: 12_345n });
    expect(() => assertFundsBalanced(lines.map((l) => ({ debitMinor: l.debitMinor, creditMinor: l.creditMinor, fund: l.fundId ?? null })))).not.toThrow();
  });
  it("release uses the release heads and the same balanced shape", () => {
    const lines = buildFundRelease({ fromFundId: A, toFundId: B, amountMinor: 1n });
    expect(lines.map((l) => l.accountCode)).toEqual([FUND_HEADS.releaseOut, FUND_HEADS.dueTo, FUND_HEADS.dueFrom, FUND_HEADS.releaseIn]);
    expect(net(lines, A)).toBe(0n);
    expect(net(lines, B)).toBe(0n);
  });
  it("same fund / non-positive amount are refused", () => {
    expect(() => buildInterFundTransfer({ fromFundId: A, toFundId: A, amountMinor: 1n })).toThrow(/FUND_TRANSFER_SAME_FUND/);
    expect(() => buildInterFundTransfer({ fromFundId: A, toFundId: B, amountMinor: 0n })).toThrow(/FUND_TRANSFER_AMOUNT/);
    expect(() => buildFundRelease({ fromFundId: A, toFundId: B, amountMinor: -5n })).toThrow(/FUND_TRANSFER_AMOUNT/);
  });
});

describe("opening balances by fund", () => {
  it("collision = same account AND same fund; NULL fund is GENERAL; no fund anywhere = the old same-account rule", () => {
    expect(openingEntryConflicts([{ accountCode: "1100" }], { accountCode: "1100" })).toBe(true);
    expect(openingEntryConflicts([{ accountCode: "1100", fundId: null }], { accountCode: "1100", fundId: null })).toBe(true);
    expect(openingEntryConflicts([{ accountCode: "1100", fundId: A }], { accountCode: "1100", fundId: B })).toBe(false);
    expect(openingEntryConflicts([{ accountCode: "1100", fundId: A }], { accountCode: "1100", fundId: A })).toBe(true);
    expect(openingEntryConflicts([{ accountCode: "1100", fundId: A }], { accountCode: "1100" })).toBe(false);
    expect(openingEntryConflicts([{ accountCode: "1100" }], { accountCode: "1200" })).toBe(false);
  });
  it("per-fund balance applies only when an entry names a fund", () => {
    expect(() => assertOpeningBalancedPerFund([
      { accountCode: "1100", debitMinor: 100n, creditMinor: 0n }, { accountCode: "3100", debitMinor: 0n, creditMinor: 100n },
    ])).not.toThrow();
    expect(() => assertOpeningBalancedPerFund([
      { accountCode: "1100", fundId: A, debitMinor: 100n, creditMinor: 0n }, { accountCode: "3100", fundId: B, debitMinor: 0n, creditMinor: 100n },
    ])).toThrow(/OPENING_BALANCES_UNBALANCED/);
    expect(() => assertOpeningBalancedPerFund([
      { accountCode: "1100", fundId: A, debitMinor: "100", creditMinor: "0" }, { accountCode: "3100", fundId: A, debitMinor: 0, creditMinor: 100 },
    ])).not.toThrow();
  });
});

describe("the shared NULL = GENERAL read helper", () => {
  it("builds a SQL fragment both with a GENERAL id and (zero-uuid fallback) without one", () => {
    expect(coalesceFundSql("fl.fund_id", G).queryChunks.length).toBeGreaterThan(0);
    expect(coalesceFundSql("fl.fund_id", null).queryChunks.length).toBeGreaterThan(0);
    expect(coalesceFundSql(sql`x.fund_id`, G).queryChunks.length).toBeGreaterThan(0);
  });
});

describe("coalesceFundSql must never be repeated in GROUP BY (each use binds its own parameter)", () => {
  it("no finance-service source groups by an interpolated COALESCE-fund expression", async () => {
    const { SRC, listTs, read, stripComments } = await import("./_nf0-static.js");
    for (const f of listTs(SRC)) {
      const code = stripComments(read(f));
      const vars = [...code.matchAll(/const (\w+) = coalesceFundSql\(/g)].map((m) => m[1]);
      for (const v of vars) expect(code, `${f}: GROUP BY \${${v}} repeats a parameterised expression; use GROUP BY 1`).not.toMatch(new RegExp(`GROUP BY[^\\n]*\\$\\{${v}\\}`));
    }
  });
});
