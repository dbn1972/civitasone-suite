import { describe, it, expect } from "vitest";
import { cashBookTotals, countToday, isSameISTDate, openingClosing, sideAmountOrNull, toPaise } from "./cashBook";

describe("cashBookTotals (GAP-FINANCE-TREASURY-CASH-BANK-04)", () => {
  it("sums paise exactly with BigInt: 100.50 + 50.00 = 150.50", () => {
    const t = cashBookTotals([
      { receipt_minor: "10050", payment_minor: "0" },
      { receipt_minor: "5000", payment_minor: "250" },
    ]);
    expect(t.receiptTotal).toBe(15050n);
    expect(t.paymentTotal).toBe(250n);
    expect(t.receiptCount).toBe(2);
    expect(t.paymentCount).toBe(1);
  });
  it("stays exact beyond Number.MAX_SAFE_INTEGER", () => {
    const big = "9007199254740993"; // 2^53 + 1
    expect(cashBookTotals([{ receipt_minor: big }, { receipt_minor: "1" }]).receiptTotal).toBe(9007199254740994n);
  });
  it("treats unparseable amounts as zero", () => {
    expect(toPaise("abc")).toBe(0n);
    expect(toPaise(null)).toBe(0n);
  });
});

describe("isSameISTDate / countToday (GAP-FINANCE-TREASURY-CASH-BANK-03)", () => {
  it("matches a date-only value and a full ISO timestamp for the same IST day", () => {
    expect(isSameISTDate("2026-09-26", "2026-09-26")).toBe(true);
    expect(isSameISTDate("2026-09-26T05:00:00.000Z", "2026-09-26")).toBe(true);
  });
  it("converts an ISO instant to its IST day (18:40Z is already the next IST day)", () => {
    expect(isSameISTDate("2026-09-25T18:40:00.000Z", "2026-09-26")).toBe(true);
    expect(isSameISTDate("2026-09-25T18:40:00.000Z", "2026-09-25")).toBe(false);
  });
  it("does not match blanks or garbage", () => {
    expect(isSameISTDate(null, "2026-09-26")).toBe(false);
    expect(isSameISTDate("nope", "2026-09-26")).toBe(false);
  });
  it("counts both formats in one list", () => {
    expect(countToday([{ entry_date: "2026-09-26" }, { entry_date: "2026-09-26T08:00:00Z" }, { entry_date: "2026-09-25" }], "2026-09-26")).toBe(2);
  });
});

describe("openingClosing (GAP-FINANCE-TREASURY-CASH-BANK-02)", () => {
  const rows = [
    { balance_minor: "7000", receipt_minor: "0", payment_minor: "1000" }, // newest
    { balance_minor: "8000", receipt_minor: "3000", payment_minor: "0" },
    { balance_minor: "5000", receipt_minor: "5000", payment_minor: "0" }, // oldest
  ];
  it("closing = newest balance, opening = oldest balance before its movement", () => {
    expect(openingClosing(rows, true)).toEqual({ opening: 0n, closing: 7000n });
  });
  it("is withheld when the window may be truncated or empty", () => {
    expect(openingClosing(rows, false)).toBeNull();
    expect(openingClosing([], true)).toBeNull();
  });
});

describe("sideAmountOrNull (GAP-FINANCE-TREASURY-CASH-BANK-06)", () => {
  it("is null for the empty side and keeps the paise string for the used side", () => {
    expect(sideAmountOrNull("0")).toBeNull();
    expect(sideAmountOrNull(null)).toBeNull();
    expect(sideAmountOrNull("50000")).toBe("50000");
  });
});
