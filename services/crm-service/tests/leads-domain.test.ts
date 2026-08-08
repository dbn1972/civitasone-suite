/**
 * CRM Leads — scoring, completeness, qualification, field rules domain tests.
 * Pack #14. Source: modules/leads/scoring.ts, completeness.ts, qualification-domain.ts, field-rules-domain.ts
 */
import { describe, it, expect } from "vitest";
import { computeLeadScore, type ScoringRule } from "../src/modules/leads/scoring.js";
import { computeCompleteness, resolveWeights, DEFAULT_FIELD_WEIGHTS } from "../src/modules/leads/completeness.js";
import { computeQualification, scoreAnswer, outcomeFromScore, OUTCOME_THRESHOLDS } from "../src/modules/leads/qualification-domain.js";
import { validateRequiredFields, isMissing } from "../src/modules/leads/field-rules-domain.js";

// ─── Lead Scoring ────────────────────────────────────────────────────────────
describe("computeLeadScore", () => {
  it("returns 0 for empty rules", () => expect(computeLeadScore({}, [])).toBe(0));

  it("computes weighted score correctly", () => {
    const rules: ScoringRule[] = [
      { attribute: "source", weight: 50, scoreFn: (v) => v === "referral" ? 100 : 20 },
      { attribute: "email", weight: 50, scoreFn: (v) => v ? 80 : 10 },
    ];
    // 50*100 + 50*80 = 9000 / 100 = 90
    expect(computeLeadScore({ source: "referral", email: "a@b.com" }, rules)).toBe(90);
  });

  it("clamps to [0, 100]", () => {
    const rules: ScoringRule[] = [{ attribute: "x", weight: 100, scoreFn: () => 150 }]; // over 100
    expect(computeLeadScore({}, rules)).toBe(100);
  });

  it("missing attribute → scoreFn receives undefined", () => {
    const rules: ScoringRule[] = [{ attribute: "missing", weight: 100, scoreFn: (v) => v === undefined ? 0 : 100 }];
    expect(computeLeadScore({}, rules)).toBe(0);
  });
});

// ─── Completeness ────────────────────────────────────────────────────────────
describe("computeCompleteness", () => {
  it("100% when all fields present", () => {
    const attrs = { name: "John", email: "j@x.com", phone: "123", company: "X", designation: "CEO", city: "Delhi", leadSource: "web" };
    const result = computeCompleteness(attrs);
    expect(result.score).toBe(100);
    expect(result.missingFields).toEqual([]);
  });

  it("0% when all fields empty", () => {
    const result = computeCompleteness({});
    expect(result.score).toBe(0);
    expect(result.missingFields.length).toBe(7); // default 7 fields
  });

  it("partial completeness", () => {
    const attrs = { name: "John", email: "j@x.com" }; // 20+20 = 40 out of 100
    const result = computeCompleteness(attrs);
    expect(result.score).toBe(40);
  });

  it("treats empty string as missing", () => {
    const attrs = { name: "", email: "j@x.com" };
    const result = computeCompleteness(attrs);
    expect(result.missingFields).toContain("name");
  });
});

describe("resolveWeights", () => {
  it("returns defaults when no rules", () => expect(resolveWeights([])).toBe(DEFAULT_FIELD_WEIGHTS));
  it("filters to enabled only", () => {
    const rules = [
      { fieldName: "name", weight: 50, enabled: true },
      { fieldName: "email", weight: 50, enabled: false },
    ];
    const resolved = resolveWeights(rules);
    expect(resolved.length).toBe(1);
    expect(resolved[0]!.field).toBe("name");
  });
});

// ─── Qualification ───────────────────────────────────────────────────────────
describe("computeQualification", () => {
  it("high score → qualified", () => {
    const questions = [{ id: "q1", answerType: "bool" as const, weight: 100, outcomeRule: { whenTrue: 80, whenFalse: 20 } }];
    const result = computeQualification(questions, { q1: true });
    expect(result.score).toBe(80);
    expect(result.outcome).toBe("qualified");
  });

  it("mid score → nurture", () => {
    const questions = [{ id: "q1", answerType: "bool" as const, weight: 100, outcomeRule: { whenTrue: 50, whenFalse: 20 } }];
    const result = computeQualification(questions, { q1: true });
    expect(result.score).toBe(50);
    expect(result.outcome).toBe("nurture");
  });

  it("low score → disqualified", () => {
    const questions = [{ id: "q1", answerType: "bool" as const, weight: 100, outcomeRule: { whenTrue: 30, whenFalse: 20 } }];
    const result = computeQualification(questions, { q1: true });
    expect(result.outcome).toBe("disqualified");
  });

  it("no questions → 0 → disqualified", () => {
    const result = computeQualification([], {});
    expect(result.score).toBe(0);
    expect(result.outcome).toBe("disqualified");
  });
});

describe("outcomeFromScore thresholds", () => {
  it("≥70 = qualified", () => expect(outcomeFromScore(70)).toBe("qualified"));
  it("69 = nurture", () => expect(outcomeFromScore(69)).toBe("nurture"));
  it("≥40 = nurture", () => expect(outcomeFromScore(40)).toBe("nurture"));
  it("39 = disqualified", () => expect(outcomeFromScore(39)).toBe("disqualified"));
});

// ─── Field Rules ─────────────────────────────────────────────────────────────
describe("validateRequiredFields", () => {
  it("returns empty when all required fields present", () => {
    const rules = [{ fieldName: "name", required: true, enabled: true }, { fieldName: "email", required: true, enabled: true }];
    expect(validateRequiredFields({ name: "John", email: "j@x.com" }, rules)).toEqual([]);
  });

  it("returns missing required fields", () => {
    const rules = [{ fieldName: "name", required: true, enabled: true }, { fieldName: "email", required: true, enabled: true }];
    expect(validateRequiredFields({ name: "John" }, rules)).toEqual(["email"]);
  });

  it("disabled rules are not enforced", () => {
    const rules = [{ fieldName: "name", required: true, enabled: false }];
    expect(validateRequiredFields({}, rules)).toEqual([]);
  });

  it("non-required rules are not enforced", () => {
    const rules = [{ fieldName: "name", required: false, enabled: true }];
    expect(validateRequiredFields({}, rules)).toEqual([]);
  });
});

describe("isMissing", () => {
  it("null = missing", () => expect(isMissing(null)).toBe(true));
  it("undefined = missing", () => expect(isMissing(undefined)).toBe(true));
  it("empty string = missing", () => expect(isMissing("")).toBe(true));
  it("whitespace = missing", () => expect(isMissing("   ")).toBe(true));
  it("value = not missing", () => expect(isMissing("hello")).toBe(false));
});
