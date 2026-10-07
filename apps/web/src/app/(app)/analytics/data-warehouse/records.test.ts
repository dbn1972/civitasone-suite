import { describe, it, expect } from "vitest";
import { parseRecordCount, sumRecordCounts } from "./records";

describe("parseRecordCount", () => {
  it("accepts plain digits and Indian-grouped digits", () => {
    expect(parseRecordCount("1248320")).toBe(1248320);
    expect(parseRecordCount("12,48,320")).toBe(1248320);
  });
  it("rejects abbreviated / decimal counts rather than corrupting them", () => {
    expect(parseRecordCount("1.2 M")).toBeNull();
    expect(parseRecordCount("2 Cr")).toBeNull();
    expect(parseRecordCount("1.5")).toBeNull();
    expect(parseRecordCount("")).toBeNull();
    expect(parseRecordCount(null)).toBeNull();
  });
});

describe("sumRecordCounts (GAP-ANALYTICS-DATA-WAREHOUSE-01)", () => {
  it("marks the total partial when any row is unreadable, instead of fabricating a low number", () => {
    // Old code: "12,48,320" -> 1248320, "1.2 M" -> 12  => total 1248332 (garbage).
    const res = sumRecordCounts(["12,48,320", "1.2 M"]);
    expect(res.partial).toBe(true);
  });
  it("sums clean numeric input correctly", () => {
    const res = sumRecordCounts(["100", "2,000", "30"]);
    expect(res).toEqual({ total: 2130, partial: false });
  });
});
