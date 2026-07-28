/**
 * Application eligibility engine — age-as-on-cutoff with category relaxation,
 * experience, and qualification (R-RA-0093/0094/0095).
 */
import { describe, it, expect } from "vitest";
import { ageOn, effectiveMaxAge, evaluateEligibility, isValidCalendarDate } from "../src/modules/recruitment/eligibility.js";

describe("isValidCalendarDate", () => {
  it("accepts real dates and rejects calendar-invalid ones that pass a regex", () => {
    expect(isValidCalendarDate("2000-02-29")).toBe(true);  // leap year
    expect(isValidCalendarDate("2026-01-31")).toBe(true);
    expect(isValidCalendarDate("2026-02-30")).toBe(false); // no Feb 30
    expect(isValidCalendarDate("2026-13-01")).toBe(false); // month 13
    expect(isValidCalendarDate("2026-00-10")).toBe(false);
    expect(isValidCalendarDate("2001-02-29")).toBe(false); // not a leap year
    expect(isValidCalendarDate("bad")).toBe(false);
  });
});

describe("ageOn", () => {
  it("computes completed years, respecting the month/day boundary", () => {
    expect(ageOn("2000-01-01", "2026-01-01")).toBe(26);
    expect(ageOn("2000-06-15", "2026-06-14")).toBe(25); // day before birthday
    expect(ageOn("2000-06-15", "2026-06-15")).toBe(26); // on birthday
    expect(ageOn("2000-12-31", "2026-01-01")).toBe(25);
  });
});

describe("effectiveMaxAge", () => {
  it("adds the category relaxation to the base maximum", () => {
    const relax = { SC: 5, ST: 5, OBC: 3, PwD: 10 };
    expect(effectiveMaxAge(35, "OBC", relax)).toBe(38);
    expect(effectiveMaxAge(35, "PwD", relax)).toBe(45);
    expect(effectiveMaxAge(35, "GEN", relax)).toBe(35); // no relaxation
    expect(effectiveMaxAge(35, undefined, relax)).toBe(35);
  });
});

describe("evaluateEligibility", () => {
  const criteria = {
    ageMin: 21, ageMax: 35, cutoffDate: "2026-01-01",
    experienceMinYears: 2, allowedQualifications: ["B.Tech", "M.Tech"],
    categoryAgeRelaxation: { OBC: 3, SC: 5, PwD: 10 },
  };

  it("passes a fully-eligible general candidate", () => {
    const r = evaluateEligibility(criteria, { dateOfBirth: "1998-01-01", category: "GEN", experienceYears: 4, qualification: "B.Tech" });
    expect(r.eligible).toBe(true);
    expect(r.ageAtCutoff).toBe(28);
  });

  it("fails a general candidate over the age limit but PASSES the same age under OBC relaxation", () => {
    const dob = "1989-01-01"; // age 37 as on 2026-01-01
    const gen = evaluateEligibility(criteria, { dateOfBirth: dob, category: "GEN", experienceYears: 5, qualification: "B.Tech" });
    expect(gen.eligible).toBe(false);
    expect(gen.checks.find((k) => k.rule === "age_max")?.ok).toBe(false);
    // OBC relaxation raises max to 38 -> 37 is now eligible
    const obc = evaluateEligibility(criteria, { dateOfBirth: dob, category: "OBC", experienceYears: 5, qualification: "B.Tech" });
    expect(obc.eligible).toBe(true);
    expect(obc.effectiveMaxAge).toBe(38);
  });

  it("fails below the minimum age", () => {
    const r = evaluateEligibility(criteria, { dateOfBirth: "2010-01-01", category: "GEN", experienceYears: 3, qualification: "B.Tech" });
    expect(r.eligible).toBe(false);
    expect(r.checks.some((k) => k.rule === "age_min" && !k.ok)).toBe(true);
  });

  it("fails on insufficient experience and on a non-permitted qualification", () => {
    const exp = evaluateEligibility(criteria, { dateOfBirth: "1998-01-01", category: "GEN", experienceYears: 1, qualification: "B.Tech" });
    expect(exp.checks.find((k) => k.rule === "experience")?.ok).toBe(false);
    const qual = evaluateEligibility(criteria, { dateOfBirth: "1998-01-01", category: "GEN", experienceYears: 4, qualification: "BA" });
    expect(qual.checks.find((k) => k.rule === "qualification")?.ok).toBe(false);
  });

  it("requires DOB when an age rule is configured", () => {
    const r = evaluateEligibility({ ageMax: 35, cutoffDate: "2026-01-01" }, { category: "GEN" });
    expect(r.eligible).toBe(false);
    expect(r.checks[0].detail).toMatch(/date of birth is required/);
  });

  it("is vacuously eligible when no criteria are configured", () => {
    expect(evaluateEligibility({}, { dateOfBirth: "1998-01-01" }).eligible).toBe(true);
  });
});
