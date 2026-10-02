import { describe, it, expect } from "vitest";
import { checkAuctionCompletion, isRealCalendarDate } from "./condemnationRules";

describe("isRealCalendarDate (GAP-ASSETS-CONDEMNATION-07)", () => {
  it("accepts real days including a leap day", () => {
    expect(isRealCalendarDate("2026-10-02")).toBe(true);
    expect(isRealCalendarDate("2028-02-29")).toBe(true);
  });
  it("rejects impossible calendar dates the old regex let through", () => {
    for (const bad of ["2026-13-45", "2026-02-30", "2027-02-29", "2026-00-10", "2026-04-31", "26-1-1", ""]) {
      expect(isRealCalendarDate(bad)).toBe(false);
    }
  });
});

describe("checkAuctionCompletion (GAP-ASSETS-CONDEMNATION-04)", () => {
  const reserve = "6000050"; // ₹60,000.50

  it("flags a winning bid below the reserve", () => {
    const r = checkAuctionCompletion({ bidMinor: "6000049", proceedsMinor: "6000049", reserveMinor: reserve });
    expect(r.highestBid).toMatch(/below the auction reserve of ₹60,000\.50/);
  });

  it("accepts a bid exactly at the reserve", () => {
    expect(checkAuctionCompletion({ bidMinor: reserve, proceedsMinor: reserve, reserveMinor: reserve })).toEqual({});
  });

  it("rejects sale proceeds above the winning bid, comparing exact paise", () => {
    const r = checkAuctionCompletion({ bidMinor: "9007199254740993", proceedsMinor: "9007199254740994", reserveMinor: reserve });
    expect(r.saleProceeds).toMatch(/more than the winning bid/);
    expect(r.highestBid).toBeUndefined();
  });

  it("allows proceeds below the bid", () => {
    expect(checkAuctionCompletion({ bidMinor: "7000000", proceedsMinor: "6900000", reserveMinor: reserve })).toEqual({});
  });

  it("skips a field that is still invalid or has no reserve to compare", () => {
    expect(checkAuctionCompletion({ bidMinor: null, proceedsMinor: "1", reserveMinor: reserve })).toEqual({});
    expect(checkAuctionCompletion({ bidMinor: "1", proceedsMinor: null, reserveMinor: null })).toEqual({});
  });
});
