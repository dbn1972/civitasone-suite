import { describe, it, expect } from "vitest";
import { totalNote } from "./_limits";
import { lowStockTotalOf } from "./_data";

describe("low-stock exact total (Q37)", () => {
  it("reads meta.total from the real response shape", () => {
    expect(lowStockTotalOf({ data: [], meta: { total: 1234, limit: 500, offset: 0 } })).toBe(1234);
  });
  it("ignores a missing / non-numeric / negative total", () => {
    expect(lowStockTotalOf({ data: [] })).toBeUndefined();
    expect(lowStockTotalOf({ meta: { total: "9" } })).toBeUndefined();
    expect(lowStockTotalOf({ meta: { total: -1 } })).toBeUndefined();
    expect(lowStockTotalOf(null)).toBeUndefined();
  });
  it("renders 'Showing 500 of N' when the total exceeds the page", () => {
    expect(totalNote(500, 1234, 500, "low-stock items")).toBe("Showing 500 of 1,234 low-stock items.");
  });
  it("shows nothing when everything fits, and falls back to the cap note without a total", () => {
    expect(totalNote(40, 40, 500, "x")).toBeNull();
    expect(totalNote(500, undefined, 500, "x")).toMatch(/first 500 x/);
  });
});
