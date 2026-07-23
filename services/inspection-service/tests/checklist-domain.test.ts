/**
 * Unit tests for checklist domain logic.
 * Pure functions — no mocks, no I/O, no DB.
 *
 * Validates: Requirements 5.1, 5.2, 5.4, 5.5, 5.6, 5.7, 5.8
 */
import { describe, it, expect } from "vitest";
import {
  validateUniqueQuestionIds,
  computeChecklistScores,
  evaluateConditionalLogic,
  validateCompletion,
  assertTemplatePublished,
  assertTemplateDraft,
  checkPrerequisiteSection,
  DomainError,
  type ChecklistSection,
  type ChecklistQuestion,
  type ConditionalRule,
  type ResponseEntry,
} from "../src/modules/checklist/domain.js";

// ── Test Helpers ──────────────────────────────────────────────────────────────

function makeQuestion(overrides: Partial<ChecklistQuestion> & { id: string }): ChecklistQuestion {
  return {
    text: "Test question",
    fieldType: "text",
    sortOrder: 1,
    weight: 1,
    required: true,
    ...overrides,
  };
}

function makeSection(overrides: Partial<ChecklistSection> & { id: string }): ChecklistSection {
  return {
    title: "Test section",
    sortOrder: 1,
    weight: 1,
    questions: [],
    ...overrides,
  };
}

function makeResponse(value: unknown = "answered"): ResponseEntry {
  return { value, answeredAt: new Date().toISOString() };
}

// ── validateUniqueQuestionIds ─────────────────────────────────────────────────

describe("validateUniqueQuestionIds", () => {
  it("returns true when all question IDs are unique across sections", () => {
    const sections = [
      makeSection({ id: "s1", questions: [makeQuestion({ id: "q1" }), makeQuestion({ id: "q2" })] }),
      makeSection({ id: "s2", questions: [makeQuestion({ id: "q3" }), makeQuestion({ id: "q4" })] }),
    ];
    expect(validateUniqueQuestionIds(sections)).toBe(true);
  });

  it("returns true for empty sections array", () => {
    expect(validateUniqueQuestionIds([])).toBe(true);
  });

  it("returns true for sections with no questions", () => {
    const sections = [makeSection({ id: "s1", questions: [] })];
    expect(validateUniqueQuestionIds(sections)).toBe(true);
  });

  it("throws DomainError when duplicate IDs exist within a section", () => {
    const sections = [
      makeSection({ id: "s1", questions: [makeQuestion({ id: "q1" }), makeQuestion({ id: "q1" })] }),
    ];
    expect(() => validateUniqueQuestionIds(sections)).toThrow(DomainError);
    expect(() => validateUniqueQuestionIds(sections)).toThrow("Duplicate question IDs found: q1");
  });

  it("throws DomainError when duplicate IDs exist across sections", () => {
    const sections = [
      makeSection({ id: "s1", questions: [makeQuestion({ id: "q1" })] }),
      makeSection({ id: "s2", questions: [makeQuestion({ id: "q1" })] }),
    ];
    expect(() => validateUniqueQuestionIds(sections)).toThrow(DomainError);
  });

  it("DomainError has code DUPLICATE_QUESTION_IDS", () => {
    const sections = [
      makeSection({ id: "s1", questions: [makeQuestion({ id: "q1" }), makeQuestion({ id: "q1" })] }),
    ];
    try {
      validateUniqueQuestionIds(sections);
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("DUPLICATE_QUESTION_IDS");
    }
  });

  it("lists all duplicates in the error message", () => {
    const sections = [
      makeSection({ id: "s1", questions: [makeQuestion({ id: "q1" }), makeQuestion({ id: "q2" })] }),
      makeSection({ id: "s2", questions: [makeQuestion({ id: "q1" }), makeQuestion({ id: "q2" })] }),
    ];
    expect(() => validateUniqueQuestionIds(sections)).toThrow("q1, q2");
  });
});

// ── computeChecklistScores ────────────────────────────────────────────────────

describe("computeChecklistScores", () => {
  it("computes 100% when all required questions are answered", () => {
    const sections = [
      makeSection({
        id: "s1",
        weight: 1,
        questions: [
          makeQuestion({ id: "q1", weight: 1, required: true }),
          makeQuestion({ id: "q2", weight: 1, required: true }),
        ],
      }),
    ];
    const responses = { q1: makeResponse(), q2: makeResponse() };
    const result = computeChecklistScores(sections, responses);

    expect(result.sectionScores["s1"]).toBe(100);
    expect(result.overallScore).toBe(100);
  });

  it("computes 0% when no required questions are answered", () => {
    const sections = [
      makeSection({
        id: "s1",
        weight: 1,
        questions: [
          makeQuestion({ id: "q1", weight: 1, required: true }),
          makeQuestion({ id: "q2", weight: 1, required: true }),
        ],
      }),
    ];
    const result = computeChecklistScores(sections, {});

    expect(result.sectionScores["s1"]).toBe(0);
    expect(result.overallScore).toBe(0);
  });

  it("computes partial score based on answered weight ratio", () => {
    const sections = [
      makeSection({
        id: "s1",
        weight: 1,
        questions: [
          makeQuestion({ id: "q1", weight: 3, required: true }),
          makeQuestion({ id: "q2", weight: 1, required: true }),
        ],
      }),
    ];
    // Only q1 answered (weight 3 of total 4) → 75%
    const responses = { q1: makeResponse() };
    const result = computeChecklistScores(sections, responses);

    expect(result.sectionScores["s1"]).toBe(75);
    expect(result.overallScore).toBe(75);
  });

  it("gives 100% to sections with no required questions", () => {
    const sections = [
      makeSection({
        id: "s1",
        weight: 1,
        questions: [
          makeQuestion({ id: "q1", weight: 1, required: false }),
        ],
      }),
    ];
    const result = computeChecklistScores(sections, {});

    expect(result.sectionScores["s1"]).toBe(100);
    expect(result.overallScore).toBe(100);
  });

  it("computes weighted overall score across multiple sections", () => {
    const sections = [
      makeSection({
        id: "s1",
        weight: 3,
        questions: [makeQuestion({ id: "q1", weight: 1, required: true })],
      }),
      makeSection({
        id: "s2",
        weight: 1,
        questions: [makeQuestion({ id: "q2", weight: 1, required: true })],
      }),
    ];
    // s1 answered (100%, weight 3), s2 not answered (0%, weight 1)
    // overall = (3*100 + 1*0) / 4 = 75
    const responses = { q1: makeResponse() };
    const result = computeChecklistScores(sections, responses);

    expect(result.sectionScores["s1"]).toBe(100);
    expect(result.sectionScores["s2"]).toBe(0);
    expect(result.overallScore).toBe(75);
  });

  it("ignores optional questions in score computation", () => {
    const sections = [
      makeSection({
        id: "s1",
        weight: 1,
        questions: [
          makeQuestion({ id: "q1", weight: 1, required: true }),
          makeQuestion({ id: "q2", weight: 5, required: false }),
        ],
      }),
    ];
    // Only q1 is required; it's answered → 100%
    const responses = { q1: makeResponse() };
    const result = computeChecklistScores(sections, responses);

    expect(result.sectionScores["s1"]).toBe(100);
  });

  it("returns 0 overall score for empty sections", () => {
    const result = computeChecklistScores([], {});
    expect(result.overallScore).toBe(0);
  });
});

// ── evaluateConditionalLogic ──────────────────────────────────────────────────

describe("evaluateConditionalLogic", () => {
  describe("show action", () => {
    it("returns true when eq condition matches", () => {
      const rule: ConditionalRule = { dependsOn: "q1", operator: "eq", value: "yes", action: "show" };
      const responses = { q1: { value: "yes" } };
      expect(evaluateConditionalLogic(rule, responses)).toBe(true);
    });

    it("returns false when eq condition does not match", () => {
      const rule: ConditionalRule = { dependsOn: "q1", operator: "eq", value: "yes", action: "show" };
      const responses = { q1: { value: "no" } };
      expect(evaluateConditionalLogic(rule, responses)).toBe(false);
    });

    it("returns true when neq condition matches", () => {
      const rule: ConditionalRule = { dependsOn: "q1", operator: "neq", value: "yes", action: "show" };
      const responses = { q1: { value: "no" } };
      expect(evaluateConditionalLogic(rule, responses)).toBe(true);
    });

    it("returns false when neq condition does not match", () => {
      const rule: ConditionalRule = { dependsOn: "q1", operator: "neq", value: "yes", action: "show" };
      const responses = { q1: { value: "yes" } };
      expect(evaluateConditionalLogic(rule, responses)).toBe(false);
    });

    it("returns true when gt condition matches", () => {
      const rule: ConditionalRule = { dependsOn: "q1", operator: "gt", value: 5, action: "show" };
      const responses = { q1: { value: 10 } };
      expect(evaluateConditionalLogic(rule, responses)).toBe(true);
    });

    it("returns false when gt condition does not match (equal)", () => {
      const rule: ConditionalRule = { dependsOn: "q1", operator: "gt", value: 5, action: "show" };
      const responses = { q1: { value: 5 } };
      expect(evaluateConditionalLogic(rule, responses)).toBe(false);
    });

    it("returns true when lt condition matches", () => {
      const rule: ConditionalRule = { dependsOn: "q1", operator: "lt", value: 10, action: "show" };
      const responses = { q1: { value: 3 } };
      expect(evaluateConditionalLogic(rule, responses)).toBe(true);
    });

    it("returns false when lt condition does not match (equal)", () => {
      const rule: ConditionalRule = { dependsOn: "q1", operator: "lt", value: 10, action: "show" };
      const responses = { q1: { value: 10 } };
      expect(evaluateConditionalLogic(rule, responses)).toBe(false);
    });
  });

  describe("hide action", () => {
    it("returns false (hidden) when eq condition matches", () => {
      const rule: ConditionalRule = { dependsOn: "q1", operator: "eq", value: "yes", action: "hide" };
      const responses = { q1: { value: "yes" } };
      expect(evaluateConditionalLogic(rule, responses)).toBe(false);
    });

    it("returns true (visible) when eq condition does not match", () => {
      const rule: ConditionalRule = { dependsOn: "q1", operator: "eq", value: "yes", action: "hide" };
      const responses = { q1: { value: "no" } };
      expect(evaluateConditionalLogic(rule, responses)).toBe(true);
    });
  });

  describe("missing response", () => {
    it("returns false for show with eq when response is missing", () => {
      const rule: ConditionalRule = { dependsOn: "q1", operator: "eq", value: "yes", action: "show" };
      const responses = {};
      expect(evaluateConditionalLogic(rule, responses)).toBe(false);
    });

    it("returns true for show with neq when response is missing", () => {
      const rule: ConditionalRule = { dependsOn: "q1", operator: "neq", value: "yes", action: "show" };
      const responses = {};
      // undefined !== "yes" → condition met → show
      expect(evaluateConditionalLogic(rule, responses)).toBe(true);
    });
  });
});

// ── validateCompletion ────────────────────────────────────────────────────────

describe("validateCompletion", () => {
  it("returns valid when all required questions answered and evidence sufficient", () => {
    const sections = [
      makeSection({
        id: "s1",
        questions: [makeQuestion({ id: "q1", required: true }), makeQuestion({ id: "q2", required: true })],
      }),
    ];
    const responses = { q1: makeResponse(), q2: makeResponse() };
    const result = validateCompletion(sections, responses, 2, 2);

    expect(result.valid).toBe(true);
    expect(result.missingItems).toHaveLength(0);
  });

  it("returns invalid when required questions are missing", () => {
    const sections = [
      makeSection({
        id: "s1",
        questions: [makeQuestion({ id: "q1", required: true }), makeQuestion({ id: "q2", required: true })],
      }),
    ];
    const responses = { q1: makeResponse() };
    const result = validateCompletion(sections, responses, 2, 2);

    expect(result.valid).toBe(false);
    expect(result.missingItems).toContain("question:q2");
  });

  it("returns invalid when evidence count is insufficient", () => {
    const sections = [
      makeSection({
        id: "s1",
        questions: [makeQuestion({ id: "q1", required: true })],
      }),
    ];
    const responses = { q1: makeResponse() };
    const result = validateCompletion(sections, responses, 1, 3);

    expect(result.valid).toBe(false);
    expect(result.missingItems).toContain("evidence:need 3, have 1");
  });

  it("ignores optional questions in completion check", () => {
    const sections = [
      makeSection({
        id: "s1",
        questions: [
          makeQuestion({ id: "q1", required: true }),
          makeQuestion({ id: "q2", required: false }),
        ],
      }),
    ];
    const responses = { q1: makeResponse() };
    const result = validateCompletion(sections, responses, 1, 1);

    expect(result.valid).toBe(true);
  });

  it("returns valid with zero required evidence", () => {
    const sections = [
      makeSection({ id: "s1", questions: [makeQuestion({ id: "q1", required: true })] }),
    ];
    const responses = { q1: makeResponse() };
    const result = validateCompletion(sections, responses, 0, 0);

    expect(result.valid).toBe(true);
  });

  it("lists all missing items", () => {
    const sections = [
      makeSection({
        id: "s1",
        questions: [makeQuestion({ id: "q1", required: true }), makeQuestion({ id: "q2", required: true })],
      }),
      makeSection({
        id: "s2",
        questions: [makeQuestion({ id: "q3", required: true })],
      }),
    ];
    const result = validateCompletion(sections, {}, 0, 2);

    expect(result.valid).toBe(false);
    expect(result.missingItems).toHaveLength(4); // q1, q2, q3, evidence
  });
});

// ── assertTemplatePublished ───────────────────────────────────────────────────

describe("assertTemplatePublished", () => {
  it("throws DomainError when status is 'published'", () => {
    expect(() => assertTemplatePublished("published")).toThrow(DomainError);
    expect(() => assertTemplatePublished("published")).toThrow("immutable");
  });

  it("DomainError has code TEMPLATE_IMMUTABLE", () => {
    try {
      assertTemplatePublished("published");
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("TEMPLATE_IMMUTABLE");
    }
  });

  it("does not throw when status is 'draft'", () => {
    expect(() => assertTemplatePublished("draft")).not.toThrow();
  });
});

// ── assertTemplateDraft ───────────────────────────────────────────────────────

describe("assertTemplateDraft", () => {
  it("throws DomainError when status is not 'draft'", () => {
    expect(() => assertTemplateDraft("published")).toThrow(DomainError);
  });

  it("DomainError has code TEMPLATE_NOT_DRAFT", () => {
    try {
      assertTemplateDraft("published");
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("TEMPLATE_NOT_DRAFT");
    }
  });

  it("does not throw when status is 'draft'", () => {
    expect(() => assertTemplateDraft("draft")).not.toThrow();
  });
});

// ── checkPrerequisiteSection ──────────────────────────────────────────────────

describe("checkPrerequisiteSection", () => {
  it("returns true when prerequisite score meets threshold", () => {
    const scores = { s1: 80 };
    expect(checkPrerequisiteSection("s2", scores, { sectionId: "s1", minScore: 80 })).toBe(true);
  });

  it("returns true when prerequisite score exceeds threshold", () => {
    const scores = { s1: 90 };
    expect(checkPrerequisiteSection("s2", scores, { sectionId: "s1", minScore: 80 })).toBe(true);
  });

  it("returns false when prerequisite score is below threshold", () => {
    const scores = { s1: 60 };
    expect(checkPrerequisiteSection("s2", scores, { sectionId: "s1", minScore: 80 })).toBe(false);
  });

  it("returns false when prerequisite section has no score yet", () => {
    const scores = {};
    expect(checkPrerequisiteSection("s2", scores, { sectionId: "s1", minScore: 80 })).toBe(false);
  });

  it("returns true when minScore is 0 and prereq score is 0", () => {
    const scores = { s1: 0 };
    expect(checkPrerequisiteSection("s2", scores, { sectionId: "s1", minScore: 0 })).toBe(true);
  });
});
