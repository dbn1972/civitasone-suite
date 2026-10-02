import { describe, it, expect } from "vitest";
import { tdsStatusCounts, fyQuarterCount, maskTdsPan } from "./tdsDeductions";

describe("fyQuarterCount (GAP-FINANCE-STATUTORY-TDS-RETURNS-02)", () => {
  it("keeps Q2 of two financial years apart", () => {
    expect(fyQuarterCount([
      { fy: "2025-26", quarter: "Q2" }, { fy: "2026-27", quarter: "Q2" }, { fy: "2026-27", quarter: "Q2" },
    ])).toBe(2);
  });
  it("does not count null/empty quarters", () => {
    expect(fyQuarterCount([{ fy: "2025-26", quarter: null }, { fy: "2025-26", quarter: "" }, { fy: "2025-26", quarter: "Q1" }])).toBe(1);
  });
});

describe("tdsStatusCounts (GAP-FINANCE-STATUTORY-TDS-RETURNS-01/04)", () => {
  it("uses the real deducted/deposited/filed enum, not a non-existent pending", () => {
    const c = tdsStatusCounts([{ status: "deducted" }, { status: "deducted" }, { status: "deposited" }, { status: "filed" }]);
    expect(c).toEqual({ total: 4, deducted: 2, deposited: 1, filed: 1, other: 0 });
  });
  it("unknown statuses go to other so the cards sum to total", () => {
    const c = tdsStatusCounts([{ status: "weird" }, { status: "filed" }]);
    expect(c.deducted + c.deposited + c.filed + c.other).toBe(c.total);
  });
});

describe("maskTdsPan (GAP-FINANCE-STATUTORY-TDS-RETURNS-05)", () => {
  it("masks the PAN and never leaves the full value on the row", () => {
    const out = maskTdsPan([{ id: "1", pan: "ABCDE1234F" }, { id: "2", pan: null }]);
    expect(out[0].pan).toBe("ABCDE****F");
    expect(JSON.stringify(out)).not.toContain("1234");
    expect(out[1].pan).toBeNull();
  });
});
