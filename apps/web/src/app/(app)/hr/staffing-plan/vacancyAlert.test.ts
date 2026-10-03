import { describe, it, expect } from "vitest";
import { isOverVacancyThreshold, countOverVacancyThreshold } from "./vacancyAlert";

describe("vacancy threshold (GAP-HR-WORKFORCE-STAFFING-PLAN-01)", () => {
  it("100 sanctioned / 85 filled (15 vacant) is over 10%", () => {
    expect(isOverVacancyThreshold(15, 100)).toBe(true);
  });
  it("100 sanctioned / 95 filled (5 vacant) is not", () => {
    expect(isOverVacancyThreshold(5, 100)).toBe(false);
  });
  it("exactly 10% is not over the threshold (strictly greater than)", () => {
    expect(isOverVacancyThreshold(10, 100)).toBe(false);
    expect(isOverVacancyThreshold(11, 100)).toBe(true);
  });
  it("zero sanctioned or non-finite input never flags", () => {
    expect(isOverVacancyThreshold(3, 0)).toBe(false);
    expect(isOverVacancyThreshold(Number.NaN, 100)).toBe(false);
  });
  it("counts departments over the threshold, honouring an override", () => {
    const rows = [
      { sanctionedPosts: 100, vacant: 15 },
      { sanctionedPosts: 100, vacant: 5 },
      { sanctionedPosts: "50", vacant: "10" },
    ];
    expect(countOverVacancyThreshold(rows)).toBe(2);
    expect(countOverVacancyThreshold(rows, 20)).toBe(0);
  });
});
