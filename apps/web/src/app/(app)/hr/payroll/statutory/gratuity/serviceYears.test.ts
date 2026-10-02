import { describe, it, expect } from "vitest";
import { completedServiceYears } from "./serviceYears";

describe("completedServiceYears (GAP-PAYROLL-STATUTORY-GRATUITY-03)", () => {
  it("rounds a fraction over six months up to the next year", () => {
    expect(completedServiceYears(9 + 8 / 12)).toBe(10); // 9y 8m
    expect(completedServiceYears(9.51)).toBe(10);
  });
  it("keeps exactly six months and below at the lower year", () => {
    expect(completedServiceYears(9.5)).toBe(9); // 9y 6m
    expect(completedServiceYears(9.25)).toBe(9);
    expect(completedServiceYears(9)).toBe(9);
  });
  it("is 0 for non-positive / non-finite input", () => {
    expect(completedServiceYears(0)).toBe(0);
    expect(completedServiceYears(-3)).toBe(0);
    expect(completedServiceYears(Number.NaN)).toBe(0);
    expect(completedServiceYears(Infinity)).toBe(0);
  });
});
