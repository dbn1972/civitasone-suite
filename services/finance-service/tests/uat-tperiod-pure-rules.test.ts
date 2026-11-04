/** UAT T-PERIOD (bundle 19): pure rules -- IST dates, carry-forward heads, roll-forward, lapse, deduction split, provision. */
import { describe, it, expect } from "vitest";
import { todayIST, currentPeriodIST, currentFyIST, fyOfDate, nextFy, previousFy } from "../src/shared/ist-date.js";
import { isCarryForwardHead, rollForward, lapseRow, lapseTotals, monthsOfFy, toDrCr } from "../src/modules/year-end/domain.js";
import { deductionLines } from "../src/modules/integrations/consumer.js";
import { needsBudgetProvision } from "../src/modules/budget/provision.js";
import { depreciationMemoReason } from "../src/modules/gl/depreciation-memo.js";
import { sanctionAvailable } from "../src/modules/budget/sanction-control.js";

describe("D-06: the IST calendar date, never the UTC date", () => {
  it("23:59 IST on 31 March is still 31 March, FY 2026-27", () => {
    const t = new Date("2027-03-31T18:29:00Z");
    expect(todayIST(t)).toBe("2027-03-31");
    expect(currentPeriodIST(t)).toBe("2027-03");
    expect(currentFyIST(t)).toBe("2026-27");
  });
  it("00:01 IST on 1 April (18:31 UTC on 31 March) is 1 April, FY 2027-28 -- the UTC date would say 31 March", () => {
    const t = new Date("2027-03-31T18:31:00Z");
    expect(t.toISOString().slice(0, 10)).toBe("2027-03-31");
    expect(todayIST(t)).toBe("2027-04-01");
    expect(currentPeriodIST(t)).toBe("2027-04");
    expect(currentFyIST(t)).toBe("2027-28");
  });
  it("an ordinary day boundary: 00:01 IST is the new day, 23:59 IST the old one", () => {
    expect(todayIST(new Date("2026-11-04T18:31:00Z"))).toBe("2026-11-05");
    expect(todayIST(new Date("2026-11-05T18:29:00Z"))).toBe("2026-11-05");
  });
  it("financial-year helpers", () => {
    expect(fyOfDate("2027-03-31")).toBe("2026-27");
    expect(fyOfDate("2027-04-01")).toBe("2027-28");
    expect(fyOfDate("2099-12-01")).toBe("2099-00");
    expect(nextFy("2026-27")).toBe("2027-28");
    expect(previousFy("2026-27")).toBe("2025-26");
    expect(monthsOfFy("2026-27")[0]).toBe("2026-04");
    expect(monthsOfFy("2026-27")[11]).toBe("2027-03");
  });
});

describe("D-05: which heads carry forward", () => {
  it("balance-sheet heads, deposits, advances, suspense and the Public Account carry forward", () => {
    expect(isCarryForwardHead("1100", "asset")).toBe(true);
    expect(isCarryForwardHead("1250", "capital")).toBe(true);
    expect(isCarryForwardHead("2101", "liability")).toBe(true);
    expect(isCarryForwardHead("3100", "equity")).toBe(true);
    expect(isCarryForwardHead("8443", "public_account")).toBe(true); // Civil Deposits
    expect(isCarryForwardHead("8550", "public_account")).toBe(true); // Civil Advances
    expect(isCarryForwardHead("8658", null)).toBe(true); // Suspense
    expect(isCarryForwardHead("2060", "deposit")).toBe(true);
  });
  it("revenue and expenditure heads start the year at zero", () => {
    expect(isCarryForwardHead("4100", "income")).toBe(false);
    expect(isCarryForwardHead("2202", "expense")).toBe(false);
    expect(isCarryForwardHead("5001", "expense")).toBe(false);
    expect(isCarryForwardHead("4200", "expense")).toBe(false);
    expect(isCarryForwardHead("5054", "capital")).toBe(false); // capital outlay is expenditure of the year
  });
  it("rollForward keeps carry-forward balances and moves the year net into the fund; the result still balances", () => {
    const cls: Record<string, string> = { "1100": "asset", "2101": "liability", "4100": "income", "2202": "expense" };
    const out = rollForward(new Map([["1100", 1000n], ["3100", -1000n]]), [
      { code: "1100", name: "Cash", classification: "asset", dr: 600n, cr: 200n },
      { code: "4100", name: "Fees", classification: "income", dr: 0n, cr: 600n },
      { code: "2202", name: "Edu", classification: "expense", dr: 200n, cr: 0n },
    ], (c) => ({ classification: cls[c] ?? null }), "3100");
    expect(Object.fromEntries(out)).toEqual({ "1100": 1400n, "3100": -1400n });
    expect([...out.values()].reduce((a, b) => a + b, 0n)).toBe(0n);
    expect(toDrCr(-1400n)).toEqual({ debitMinor: 0n, creditMinor: 1400n });
  });
});

describe("D-13: 31 March lapse statement", () => {
  it("unspent final grant lapses; re-appropriation is part of the final grant; an overrun is excess, never negative lapse", () => {
    const a = lapseRow({ budgetId: "b1", headId: "h1", headCode: "2202", headName: "Edu", beMinor: 1000000n, reMinor: 1200000n, utilisedMinor: 204000n });
    expect(a).toMatchObject({ reappropriationNetMinor: 200000n, lapseMinor: 996000n, excessMinor: 0n });
    const b = lapseRow({ budgetId: "b2", headId: "h2", headCode: "2210", headName: "Med", beMinor: 500n, reMinor: 400n, utilisedMinor: 450n });
    expect(b).toMatchObject({ reappropriationNetMinor: -100n, lapseMinor: 0n, excessMinor: 50n });
    expect(lapseTotals([a, b])).toMatchObject({ reMinor: 1200400n, lapseMinor: 996000n, excessMinor: 50n });
  });
});

describe("D-10: salary deductions on distinct heads", () => {
  it("one credit per non-zero deduction on its head when the parts sum to gross - net", () => {
    const lines = deductionLines(21047200n, { tds: "13542300", gpf: "0", nps: "6000000", pf: "0", esi: "0", pt: "20000", other: "1484900" });
    expect(lines.map((l) => [l.accountCode, l.creditMinor])).toEqual([["2200", 13542300n], ["2105", 6000000n], ["2108", 20000n], ["2102", 1484900n]]);
  });
  it("falls back to one 2102 leg with no breakdown, or when the breakdown does not add up", () => {
    expect(deductionLines(1000n, undefined)).toEqual([{ accountCode: "2102", debitMinor: 0n, creditMinor: 1000n, narration: "Statutory deductions payable" }]);
    expect(deductionLines(1000n, { tds: "999" }).map((l) => l.accountCode)).toEqual(["2102"]);
  });
  it("a negative part is booked on the debit side so the voucher still balances", () => {
    const lines = deductionLines(100n, { tds: "150", other: "-50" });
    const net = lines.reduce((s, l) => s + l.creditMinor - l.debitMinor, 0n);
    expect(net).toBe(100n);
  });
});

describe("D-03 / D-02: rule tables", () => {
  it("an expenditure-head debit needs a provision unless the journal is a non-cash / reversal entry", () => {
    expect(needsBudgetProvision({ code: "2202", classification: "expense" }, { type: "bill" })).toBe(true);
    expect(needsBudgetProvision({ code: "5001", classification: "expense" }, { type: "payroll_accrual" })).toBe(true);
    expect(needsBudgetProvision({ code: "1100", classification: "asset" }, { type: "receipt" })).toBe(false);
    expect(needsBudgetProvision({ code: "5100", classification: "expense" }, { type: "depreciation" })).toBe(false);
    expect(needsBudgetProvision({ code: "2202", classification: "expense" }, { type: "contra", reversesId: "x" })).toBe(false);
  });
  it("statutory depreciation is always a memorandum; company book only on cash", () => {
    expect(depreciationMemoReason("statutory", "accrual")).toBe("income_tax_memorandum");
    expect(depreciationMemoReason("company", "cash")).toBe("cash_basis_memorandum");
    expect(depreciationMemoReason("company", "accrual")).toBeNull();
  });
  it("TE-02: available = allocation - (outstanding sanctions + committed + expended)", () => {
    expect(sanctionAvailable(1500000n, 1000000n, { committedMinor: 0n, expendedMinor: 0n })).toBe(500000n);
    expect(sanctionAvailable(1500000n, 0n, { committedMinor: 200000n, expendedMinor: 300000n })).toBe(1000000n);
  });
});
