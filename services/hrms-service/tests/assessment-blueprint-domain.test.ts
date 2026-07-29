import { describe, it, expect } from "vitest";
import {
  validateScoringConfig, validateBlueprintDraft, questionReadyToValidate, totalMarks,
  QTYPES, type ScoringConfig,
} from "../src/modules/recruitment/blueprint-domain.js";

const goodConfig: ScoringConfig = {
  totalCutoffPct: 40,
  negativeMarking: { enabled: true, fraction: 0.25 },
  sections: [
    { key: "apt", title: "Aptitude", questionCount: 3, marksPerQuestion: 2, sectionCutoffPct: 33, difficultyMix: { easy: 1, medium: 1, hard: 1 } },
    { key: "dom", title: "Domain", questionCount: 2, marksPerQuestion: 5 },
  ],
  tieBreak: ["higher_section", "older_dob"],
};

describe("validateScoringConfig", () => {
  it("accepts a consistent configuration", () => {
    expect(validateScoringConfig(goodConfig)).toEqual([]);
  });

  it("requires at least one section", () => {
    expect(validateScoringConfig({ sections: [] })).toContain("at least one section is required");
  });

  it("rejects negative marking with an out-of-range fraction", () => {
    const errs = validateScoringConfig({ ...goodConfig, negativeMarking: { enabled: true, fraction: 1.5 } });
    expect(errs.some((e) => e.includes("negativeMarking.fraction"))).toBe(true);
  });

  it("rejects a difficulty mix that does not sum to questionCount", () => {
    const errs = validateScoringConfig({ sections: [{ key: "a", questionCount: 3, marksPerQuestion: 1, difficultyMix: { easy: 1, medium: 1 } }] });
    expect(errs.some((e) => e.includes("difficultyMix must sum to questionCount"))).toBe(true);
  });

  it("rejects duplicate section keys and unknown tie-break rules", () => {
    const errs = validateScoringConfig({
      sections: [{ key: "x", questionCount: 1, marksPerQuestion: 1 }, { key: "x", questionCount: 1, marksPerQuestion: 1 }],
      tieBreak: ["not_a_rule"],
    });
    expect(errs.some((e) => e.includes("duplicate section key"))).toBe(true);
    expect(errs.some((e) => e.includes('unknown rule "not_a_rule"'))).toBe(true);
  });

  it("rejects a total cut-off above 100", () => {
    expect(validateScoringConfig({ ...goodConfig, totalCutoffPct: 120 })).toContain("totalCutoffPct must be between 0 and 100");
  });

  it("computes total marks across sections", () => {
    expect(totalMarks(goodConfig)).toBe(3 * 2 + 2 * 5); // 16
  });
});

describe("validateBlueprintDraft", () => {
  const base = { code: "ASMT-1", title: "Officer Test", competencies: [{ key: "c1" }], allowedTypes: ["mcq"], durationMinutes: 60, scoringConfig: goodConfig };
  it("accepts a complete draft", () => {
    expect(validateBlueprintDraft(base)).toEqual([]);
  });
  it("requires code, competency, type, duration", () => {
    const errs = validateBlueprintDraft({ code: "", title: "", competencies: [], allowedTypes: [], durationMinutes: 0, scoringConfig: goodConfig });
    expect(errs).toContain("code is required");
    expect(errs).toContain("at least one competency is required");
    expect(errs).toContain("at least one assessment type is required");
    expect(errs).toContain("durationMinutes must be greater than 0");
  });
  it("rejects an unknown assessment type", () => {
    expect(validateBlueprintDraft({ ...base, allowedTypes: ["telepathy"] })).toContain('unknown assessment type "telepathy"');
  });
});

describe("questionReadyToValidate", () => {
  it("accepts a complete MCQ", () => {
    expect(questionReadyToValidate({
      qtype: "mcq", stem: "2+2?", topic: "math", difficulty: "easy", marks: 1,
      options: [{ id: "a", text: "3" }, { id: "b", text: "4" }], answerKey: { correct: ["b"] },
    })).toEqual([]);
  });
  it("rejects an MCQ whose correct answer is not an option", () => {
    const errs = questionReadyToValidate({
      qtype: "mcq", stem: "q", topic: "t", difficulty: "easy", marks: 1,
      options: [{ id: "a", text: "3" }, { id: "b", text: "4" }], answerKey: { correct: ["z"] },
    });
    expect(errs.some((e) => e.includes('unknown option "z"'))).toBe(true);
  });
  it("requires a rubric for descriptive and test cases for coding", () => {
    expect(questionReadyToValidate({ qtype: "descriptive", stem: "explain", topic: "t", difficulty: "hard", marks: 10, answerKey: {} }))
      .toContain("descriptive requires an evaluation rubric (answerKey.rubricRef)");
    expect(questionReadyToValidate({ qtype: "coding", stem: "sort", topic: "t", difficulty: "hard", marks: 20, answerKey: {} }))
      .toContain("coding requires answerKey.testCasesRef");
  });
  it("allows file_upload with no machine answer key", () => {
    expect(questionReadyToValidate({ qtype: "file_upload", stem: "upload", topic: "t", difficulty: "medium", marks: 5, answerKey: {} })).toEqual([]);
  });
  it("exposes the full type vocabulary", () => {
    expect(QTYPES).toContain("psychometric");
    expect(QTYPES.length).toBe(6);
  });
});
