import { describe, it, expect } from "vitest";
import { cashBookCacheKey, parseCashBookQuery, periodLabel } from "./cashBookQuery";

describe("parseCashBookQuery (GAP-FINANCE-TREASURY-CASH-BANK-01)", () => {
  it("accepts a known account type and real dates", () => {
    expect(parseCashBookQuery({ type: "bank", from: "2026-04-01", to: "2026-04-30" })).toEqual({
      type: "bank", from: "2026-04-01", to: "2026-04-30",
    });
  });
  it("drops unknown types and non-dates instead of forwarding them", () => {
    expect(parseCashBookQuery({ type: "savings", from: "2026-02-30", to: "x; drop" })).toEqual({});
    expect(parseCashBookQuery(undefined)).toEqual({});
  });
  it("swaps a reversed range", () => {
    expect(parseCashBookQuery({ from: "2026-05-01", to: "2026-04-01" })).toEqual({ from: "2026-04-01", to: "2026-05-01" });
  });
  it("keys the client cache per filter and names the period in the empty copy", () => {
    expect(cashBookCacheKey({ type: "cash", from: "2026-04-01" })).not.toBe(cashBookCacheKey({ type: "bank", from: "2026-04-01" }));
    expect(periodLabel({ type: "bank", from: "2026-04-01", to: "2026-04-30" }, (d) => d)).toBe(
      "bank book entries between 2026-04-01 and 2026-04-30",
    );
    expect(periodLabel({}, (d) => d)).toBe("cash & bank book entries");
  });
});
