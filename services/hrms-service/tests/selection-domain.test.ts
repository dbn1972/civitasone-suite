import { describe, it, expect } from "vitest";
import { validateEntries, validateApproval, isWithinValidity, type Entry } from "../src/modules/recruitment/selection-domain.js";

const E = (applicationId: string, category: string, rank: number): Entry => ({ applicationId, category, rank });

describe("validateEntries", () => {
  it("accepts contiguous ranks within vacancies", () => {
    expect(validateEntries([E("a", "selected", 1), E("b", "selected", 2), E("c", "waitlist", 1)], 2)).toEqual([]);
  });
  it("rejects more selected than vacancies", () => {
    expect(validateEntries([E("a", "selected", 1), E("b", "selected", 2)], 1).some((m) => /exceeds vacancies/.test(m))).toBe(true);
  });
  it("rejects duplicate ranks within a category", () => {
    expect(validateEntries([E("a", "selected", 1), E("b", "selected", 1)], 2).some((m) => /duplicate selected rank/.test(m))).toBe(true);
  });
  it("rejects non-contiguous ranks", () => {
    expect(validateEntries([E("a", "selected", 1), E("b", "selected", 3)], 3).some((m) => /contiguous/.test(m))).toBe(true);
  });
  it("rejects an application appearing twice (across categories)", () => {
    expect(validateEntries([E("a", "selected", 1), E("a", "waitlist", 1)], 2).some((m) => /more than once/.test(m))).toBe(true);
  });
  it("rejects an unknown category", () => {
    expect(validateEntries([E("a", "reserve", 1)], 2).some((m) => /unknown category/.test(m))).toBe(true);
  });
});

describe("validateApproval", () => {
  const future = new Date(Date.now() + 365 * 86400_000).toISOString();
  const past = new Date(Date.now() - 86400_000).toISOString();
  it("requires a validity period", () => {
    expect(validateApproval(null, Date.now()).length).toBeGreaterThan(0);
  });
  it("rejects a past validity", () => {
    expect(validateApproval(past, Date.now()).length).toBeGreaterThan(0);
  });
  it("accepts a future validity", () => {
    expect(validateApproval(future, Date.now())).toEqual([]);
  });
});

describe("isWithinValidity", () => {
  it("is true up to and including the validity day, false after", () => {
    const now = Date.now();
    expect(isWithinValidity(new Date(now + 10 * 86400_000).toISOString(), now)).toBe(true);
    expect(isWithinValidity(new Date(now - 1 * 86400_000).toISOString(), now)).toBe(false);
    expect(isWithinValidity(null, now)).toBe(false);
  });
});
