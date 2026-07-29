import { describe, it, expect } from "vitest";
import { validateExperience, type Employment } from "../src/modules/recruitment/experience-domain.js";

const NOW = Date.parse("2024-01-01");
const E = (employer: string, from: string, to: string | null, relevant = false): Employment => ({ employer, from, to, relevant });

describe("validateExperience", () => {
  it("sums non-overlapping experience and flags a gap", () => {
    const r = validateExperience([
      E("A", "2018-01-01", "2020-01-01", true),
      E("B", "2020-06-01", "2022-06-01", false),
    ], { minTotalYears: 3, minRelevantYears: 1 }, NOW);
    expect(r.totalYears).toBeCloseTo(4.0, 1);
    expect(r.relevantYears).toBeCloseTo(2.0, 1);
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0]!.months).toBeCloseTo(5, 0);
    expect(r.meetsTotal).toBe(true);
    expect(r.meetsRelevant).toBe(true);
    expect(r.eligible).toBe(true);
  });

  it("does NOT double-count overlapping employment", () => {
    const r = validateExperience([
      E("A", "2018-01-01", "2020-01-01"),
      E("B", "2019-01-01", "2021-01-01"),
    ], {}, NOW);
    expect(r.totalYears).toBeCloseTo(3.0, 1); // merged 2018-2021, not 4
    expect(r.overlaps).toEqual([{ a: "A", b: "B" }]);
  });

  it("measures an open (current) job to now", () => {
    const r = validateExperience([E("A", "2022-01-01", null, true)], { minRelevantYears: 1.5 }, NOW);
    expect(r.relevantYears).toBeCloseTo(2.0, 1);
    expect(r.meetsRelevant).toBe(true);
  });

  it("fails when total experience is short of the requirement", () => {
    const r = validateExperience([E("A", "2022-01-01", "2023-01-01")], { minTotalYears: 3 }, NOW);
    expect(r.meetsTotal).toBe(false);
    expect(r.eligible).toBe(false);
  });

  it("flags a gap exceeding the allowed maximum", () => {
    const r = validateExperience([
      E("A", "2015-01-01", "2017-01-01"),
      E("B", "2020-01-01", "2023-01-01"),
    ], { maxGapMonths: 12 }, NOW);
    expect(r.gaps[0]!.months).toBeCloseTo(36, 0);
    expect(r.gapsWithinLimit).toBe(false);
    expect(r.eligible).toBe(false);
  });

  it("does NOT round a just-short candidate up to eligible (raw comparison)", () => {
    // 2019-01-01 .. 2023-12-31 = 4 years 364 days (~4.997y), one day short of 5
    const r = validateExperience([E("A", "2019-01-01", "2023-12-31", true)], { minTotalYears: 5 }, NOW);
    expect(r.totalYears).toBe(5); // display rounds to 5.0
    expect(r.meetsTotal).toBe(false); // ...but the eligibility check uses the raw duration
    expect(r.eligible).toBe(false);
  });

  it("labels gap employers correctly even when two jobs share an end date", () => {
    const r = validateExperience([
      E("A", "2015-01-01", "2018-01-01"),
      E("B", "2016-01-01", "2018-01-01"), // same end as A
      E("C", "2021-01-01", "2023-01-01"),
    ], {}, NOW);
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0]!.beforeEmployer).toBe("C"); // gap is before C
  });

  it("reports invalid date ranges without crashing", () => {
    const r = validateExperience([E("A", "2020-01-01", "2019-01-01")], {}, NOW);
    expect(r.invalid).toHaveLength(1);
    expect(r.eligible).toBe(false);
  });
});
