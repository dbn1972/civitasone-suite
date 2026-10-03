import { describe, it, expect } from "vitest";
import { percentToBps, isDiscounted, parseSchedule } from "./leaseTerms";

describe("leaseTerms (GAP-ASSETS-LEASES-07)", () => {
  it("converts a percent to exact basis points without float math", () => {
    expect(percentToBps("8")).toBe(800);
    expect(percentToBps("8.5")).toBe(850);
    expect(percentToBps("12.25")).toBe(1225);
    expect(percentToBps("0")).toBe(0);
    expect(percentToBps("100")).toBe(10000);
  });
  it("rejects malformed, negative and above-100% rates", () => {
    for (const bad of ["", "abc", "-1", "8.555", "100.01", "101", "1,5"]) expect(percentToBps(bad)).toBeNull();
  });
  it("treats either discounting field as opting in", () => {
    expect(isDiscounted("", "")).toBe(false);
    expect(isDiscounted(" ", " ")).toBe(false);
    expect(isDiscounted("8", "")).toBe(true);
    expect(isDiscounted("", "10000")).toBe(true);
  });
  it("parses schedule rows and drops malformed ones", () => {
    const rows = parseSchedule({ data: [
      { seq: 1, dueDate: "2026-04-30", openingMinor: "100", interestMinor: "1", paymentMinor: "10", principalMinor: "9", closingMinor: "91" },
      { seq: 2, dueDate: "2026-05-31", openingMinor: "x", interestMinor: "1", paymentMinor: "10", principalMinor: "9", closingMinor: "91" },
    ] });
    expect(rows).toHaveLength(1);
    expect(parseSchedule(null)).toBeNull();
  });
});
