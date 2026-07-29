import { describe, it, expect } from "vitest";
import { validateEducation, type Qualification } from "../src/modules/recruitment/education-domain.js";

const Q = (level: string, discipline?: string, percentage?: number, institution?: string): Qualification => ({ level, discipline, percentage, institution });

describe("validateEducation", () => {
  it("passes when the highest level meets the minimum and discipline matches", () => {
    const r = validateEducation([Q("12th", "science"), Q("bachelor", "computer science", 72)], { minLevel: "bachelor", requiredDisciplines: ["Computer Science", "IT"] });
    expect(r.highestLevel).toBe("bachelor");
    expect(r.meetsLevel).toBe(true);
    expect(r.meetsDiscipline).toBe(true);
    expect(r.eligible).toBe(true);
  });

  it("fails when the highest level is below the minimum", () => {
    const r = validateEducation([Q("diploma", "mechanical")], { minLevel: "bachelor" });
    expect(r.meetsLevel).toBe(false);
    expect(r.eligible).toBe(false);
  });

  it("does not let a below-level qualification satisfy the discipline", () => {
    // requires a bachelor in CS; candidate has a bachelor in Arts and a 12th in CS
    const r = validateEducation([Q("12th", "computer science"), Q("bachelor", "arts")], { minLevel: "bachelor", requiredDisciplines: ["Computer Science"] });
    expect(r.meetsLevel).toBe(true);
    expect(r.meetsDiscipline).toBe(false); // the CS is only at 12th, below the required bachelor
    expect(r.eligible).toBe(false);
  });

  it("enforces a minimum percentage on the qualifying degree", () => {
    const ok = validateEducation([Q("bachelor", "commerce", 65)], { minLevel: "bachelor", minPercentage: 60 });
    expect(ok.eligible).toBe(true);
    const bad = validateEducation([Q("bachelor", "commerce", 55)], { minLevel: "bachelor", minPercentage: 60 });
    expect(bad.meetsPercentage).toBe(false);
    expect(bad.eligible).toBe(false);
  });

  it("flags an unknown qualification level", () => {
    const r = validateEducation([Q("post_doc")], { minLevel: "bachelor" });
    expect(r.issues.some((m) => /unknown qualification level/.test(m))).toBe(true);
    expect(r.eligible).toBe(false);
  });

  it("requires institution details when configured", () => {
    const r = validateEducation([Q("bachelor", "science", 70, undefined)], { minLevel: "bachelor", recognisedInstitutionsOnly: true });
    expect(r.eligible).toBe(false);
    const ok = validateEducation([Q("bachelor", "science", 70, "Delhi University")], { minLevel: "bachelor", recognisedInstitutionsOnly: true });
    expect(ok.eligible).toBe(true);
  });
});
