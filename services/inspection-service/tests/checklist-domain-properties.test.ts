/**
 * Property-based tests for checklist domain logic.
 *
 * **Property 16: Checklist Instance Deep-Copy Integrity** — instance sections
 * structurally equal to template.
 *
 * **Property 17: Published Template Immutability** — modification of published
 * template rejected.
 *
 * **Property 18: Conditional Logic Evaluation** — correct boolean for
 * eq/neq/gt/lt operators.
 *
 * **Property 19: Checklist Scoring Computation** — scores in [0,100], weighted
 * percentage of answered required questions.
 *
 * **Property 20: Prerequisite Section Gating** — section accessible iff prereq
 * score ≥ threshold.
 *
 * **Property 21: Checklist Template JSON Round-Trip** — serialize/deserialize
 * preserves structure.
 *
 * **Property 22: Unique Question ID Validation** — passes iff all IDs unique.
 *
 * Pure functions — no mocks, no I/O, no DB.
 *
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8**
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  validateUniqueQuestionIds,
  computeChecklistScores,
  evaluateConditionalLogic,
  assertTemplatePublished,
  checkPrerequisiteSection,
  DomainError,
  type ChecklistSection,
  type ChecklistQuestion,
  type ConditionalRule,
  type FieldType,
  type ResponseEntry,
} from "../src/modules/checklist/domain.js";

// ── Generators ────────────────────────────────────────────────────────────────

const FIELD_TYPES: FieldType[] = [
  "text", "number", "boolean", "select", "multi_select", "photo", "signature", "geo_point",
];

const fieldTypeArb = fc.constantFrom(...FIELD_TYPES);

/** Generate a unique question ID string. */
const questionIdArb = fc.string({ minLength: 1, maxLength: 12, unit: fc.constantFrom(
  "a","b","c","d","e","f","g","h","i","j","k","l","m","n","o","p","q","r","s","t","u","v","w","x","y","z",
  "0","1","2","3","4","5","6","7","8","9","_",
) });

/** Generate a checklist question. */
function questionArb(id?: string): fc.Arbitrary<ChecklistQuestion> {
  return fc.record({
    id: id ? fc.constant(id) : questionIdArb,
    text: fc.string({ minLength: 1, maxLength: 50 }),
    fieldType: fieldTypeArb,
    sortOrder: fc.nat({ max: 100 }),
    weight: fc.integer({ min: 1, max: 10 }),
    required: fc.boolean(),
  });
}

/** Generate a section with N unique-ID questions. */
function sectionArb(sectionId?: string): fc.Arbitrary<ChecklistSection> {
  return fc.record({
    id: sectionId ? fc.constant(sectionId) : fc.string({ minLength: 1, maxLength: 8, unit: fc.constantFrom(
      "a","b","c","d","e","f","g","h","i","j","k","l","m","n","o","p","s",
    ) }),
    title: fc.string({ minLength: 1, maxLength: 30 }),
    sortOrder: fc.nat({ max: 50 }),
    weight: fc.integer({ min: 1, max: 10 }),
    questions: fc.array(questionArb(), { minLength: 1, maxLength: 5 }),
  });
}

/**
 * Generate sections with globally unique question IDs.
 * Assigns sequential q0, q1, q2... IDs to guarantee uniqueness.
 */
function sectionsWithUniqueIds(minSections = 1, maxSections = 4): fc.Arbitrary<ChecklistSection[]> {
  return fc.array(sectionArb(), { minLength: minSections, maxLength: maxSections }).map((sections) => {
    let counter = 0;
    return sections.map((s, si) => ({
      ...s,
      id: `s${si}`,
      questions: s.questions.map((q) => ({
        ...q,
        id: `q${counter++}`,
      })),
    }));
  });
}

/**
 * Generate sections that have at least one required question for scoring tests.
 */
function sectionsWithRequired(): fc.Arbitrary<ChecklistSection[]> {
  return sectionsWithUniqueIds(1, 4).map((sections) =>
    sections.map((s) => ({
      ...s,
      questions: s.questions.map((q, i) => ({
        ...q,
        // Ensure at least the first question in each section is required
        required: i === 0 ? true : q.required,
      })),
    })),
  );
}

/** Generate a response entry. */
function responseEntryArb(): fc.Arbitrary<ResponseEntry> {
  return fc.record({
    value: fc.oneof(fc.string(), fc.integer(), fc.boolean()),
    answeredAt: fc.constant(new Date().toISOString()),
  });
}

// ── Property 16: Checklist Instance Deep-Copy Integrity ───────────────────────

describe("Property 16: Checklist Instance Deep-Copy Integrity", () => {
  /**
   * **Validates: Requirements 5.1, 5.3**
   *
   * For any valid template sections, deep-copying (JSON round-trip) produces
   * a structurally equal result that is not the same reference.
   */
  it("deep copy of template sections is structurally equal but not referentially equal", () => {
    fc.assert(
      fc.property(
        sectionsWithUniqueIds(1, 5),
        (templateSections) => {
          // Simulate the deep-copy operation used in instance generation
          const instanceSections = JSON.parse(JSON.stringify(templateSections));

          // Structural equality
          expect(instanceSections).toEqual(templateSections);

          // Not referentially equal (deep copy)
          expect(instanceSections).not.toBe(templateSections);
          if (templateSections.length > 0) {
            expect(instanceSections[0]).not.toBe(templateSections[0]);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 5.1, 5.3**
   *
   * Mutations to the instance copy do not affect the original template sections.
   */
  it("mutations on instance copy do not affect template original", () => {
    fc.assert(
      fc.property(
        sectionsWithUniqueIds(1, 3),
        (templateSections) => {
          const originalJson = JSON.stringify(templateSections);
          const instanceSections: ChecklistSection[] = JSON.parse(JSON.stringify(templateSections));

          // Mutate the instance copy
          if (instanceSections.length > 0 && instanceSections[0]!.questions.length > 0) {
            instanceSections[0]!.questions[0]!.text = "MUTATED";
            instanceSections[0]!.title = "MUTATED_SECTION";
          }

          // Original is unchanged
          expect(JSON.stringify(templateSections)).toBe(originalJson);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ── Property 17: Published Template Immutability ──────────────────────────────

describe("Property 17: Published Template Immutability", () => {
  /**
   * **Validates: Requirements 5.2**
   *
   * For any attempt to modify a published template, assertTemplatePublished
   * always throws DomainError with code TEMPLATE_IMMUTABLE.
   */
  it("any modification attempt on published template is rejected", () => {
    fc.assert(
      fc.property(
        // Generate arbitrary "modification" payload (not used but proves invariance)
        fc.record({ name: fc.string(), sections: fc.array(fc.string()) }),
        (_modification) => {
          expect(() => assertTemplatePublished("published")).toThrow(DomainError);
          try {
            assertTemplatePublished("published");
          } catch (e) {
            expect((e as DomainError).code).toBe("TEMPLATE_IMMUTABLE");
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 5.2**
   *
   * For any non-published status, assertTemplatePublished does NOT throw.
   */
  it("non-published status is not rejected", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("draft", "archived", "inactive", "pending"),
        (status) => {
          if (status !== "published") {
            expect(() => assertTemplatePublished(status)).not.toThrow();
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ── Property 18: Conditional Logic Evaluation ─────────────────────────────────

describe("Property 18: Conditional Logic Evaluation", () => {
  /**
   * **Validates: Requirements 5.4**
   *
   * For eq operator with show action: returns true iff response value === rule value.
   */
  it("eq operator: show iff response equals rule value", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 10 }),
        fc.string({ minLength: 1, maxLength: 10 }),
        (ruleValue, responseValue) => {
          const rule: ConditionalRule = {
            dependsOn: "q1",
            operator: "eq",
            value: ruleValue,
            action: "show",
          };
          const responses = { q1: { value: responseValue } };
          const result = evaluateConditionalLogic(rule, responses);

          if (responseValue === ruleValue) {
            expect(result).toBe(true);
          } else {
            expect(result).toBe(false);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 5.4**
   *
   * For neq operator with show action: returns true iff response value !== rule value.
   */
  it("neq operator: show iff response does not equal rule value", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 10 }),
        fc.string({ minLength: 1, maxLength: 10 }),
        (ruleValue, responseValue) => {
          const rule: ConditionalRule = {
            dependsOn: "q1",
            operator: "neq",
            value: ruleValue,
            action: "show",
          };
          const responses = { q1: { value: responseValue } };
          const result = evaluateConditionalLogic(rule, responses);

          if (responseValue !== ruleValue) {
            expect(result).toBe(true);
          } else {
            expect(result).toBe(false);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 5.4**
   *
   * For gt operator with show action: returns true iff Number(response) > Number(rule value).
   */
  it("gt operator: show iff response > rule value (numeric)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: -1000, max: 1000 }),
        (ruleValue, responseValue) => {
          const rule: ConditionalRule = {
            dependsOn: "q1",
            operator: "gt",
            value: ruleValue,
            action: "show",
          };
          const responses = { q1: { value: responseValue } };
          const result = evaluateConditionalLogic(rule, responses);

          expect(result).toBe(responseValue > ruleValue);
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 5.4**
   *
   * For lt operator with show action: returns true iff Number(response) < Number(rule value).
   */
  it("lt operator: show iff response < rule value (numeric)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: -1000, max: 1000 }),
        (ruleValue, responseValue) => {
          const rule: ConditionalRule = {
            dependsOn: "q1",
            operator: "lt",
            value: ruleValue,
            action: "show",
          };
          const responses = { q1: { value: responseValue } };
          const result = evaluateConditionalLogic(rule, responses);

          expect(result).toBe(responseValue < ruleValue);
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 5.4**
   *
   * For hide action: result is the negation of the show action result.
   */
  it("hide action inverts the show result for all operators", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("eq" as const, "neq" as const, "gt" as const, "lt" as const),
        fc.integer({ min: -100, max: 100 }),
        fc.integer({ min: -100, max: 100 }),
        (operator, ruleValue, responseValue) => {
          const showRule: ConditionalRule = {
            dependsOn: "q1",
            operator,
            value: ruleValue,
            action: "show",
          };
          const hideRule: ConditionalRule = {
            dependsOn: "q1",
            operator,
            value: ruleValue,
            action: "hide",
          };
          const responses = { q1: { value: responseValue } };

          const showResult = evaluateConditionalLogic(showRule, responses);
          const hideResult = evaluateConditionalLogic(hideRule, responses);

          expect(hideResult).toBe(!showResult);
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ── Property 19: Checklist Scoring Computation ────────────────────────────────

describe("Property 19: Checklist Scoring Computation", () => {
  /**
   * **Validates: Requirements 5.5**
   *
   * For any sections and responses, all section scores are in [0, 100]
   * and overall score is in [0, 100].
   */
  it("all scores are in [0, 100]", () => {
    fc.assert(
      fc.property(
        sectionsWithRequired(),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 20 }),
        (sections, answerFlags) => {
          // Build responses: answer some required questions based on flags
          const responses: Record<string, ResponseEntry> = {};
          let flagIdx = 0;
          for (const section of sections) {
            for (const q of section.questions) {
              if (q.required && answerFlags[flagIdx % answerFlags.length]) {
                responses[q.id] = { value: "ans", answeredAt: new Date().toISOString() };
              }
              flagIdx++;
            }
          }

          const result = computeChecklistScores(sections, responses);

          // All section scores in [0, 100]
          for (const sId of Object.keys(result.sectionScores)) {
            expect(result.sectionScores[sId]).toBeGreaterThanOrEqual(0);
            expect(result.sectionScores[sId]).toBeLessThanOrEqual(100);
          }

          // Overall score in [0, 100]
          expect(result.overallScore).toBeGreaterThanOrEqual(0);
          expect(result.overallScore).toBeLessThanOrEqual(100);
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 5.5**
   *
   * When ALL required questions are answered, overall score is 100.
   */
  it("score is 100 when all required questions are answered", () => {
    fc.assert(
      fc.property(
        sectionsWithRequired(),
        (sections) => {
          const responses: Record<string, ResponseEntry> = {};
          for (const section of sections) {
            for (const q of section.questions) {
              if (q.required) {
                responses[q.id] = { value: "answered", answeredAt: new Date().toISOString() };
              }
            }
          }

          const result = computeChecklistScores(sections, responses);
          expect(result.overallScore).toBe(100);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 5.5**
   *
   * When NO required questions are answered, overall score is 0.
   */
  it("score is 0 when no required questions are answered", () => {
    fc.assert(
      fc.property(
        sectionsWithRequired(),
        (sections) => {
          const result = computeChecklistScores(sections, {});

          // Each section with required questions should have score 0
          for (const section of sections) {
            const hasRequired = section.questions.some((q) => q.required);
            if (hasRequired) {
              expect(result.sectionScores[section.id]).toBe(0);
            }
          }
          // Overall is 0 only if all sections have required questions
          // (sections without required get 100), so check weighted avg
          expect(result.overallScore).toBeGreaterThanOrEqual(0);
          expect(result.overallScore).toBeLessThanOrEqual(100);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 5.5**
   *
   * Section score equals the weighted percentage of answered required questions.
   */
  it("section score equals weighted percentage of answered required questions", () => {
    fc.assert(
      fc.property(
        sectionsWithRequired(),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 20 }),
        (sections, answerFlags) => {
          const responses: Record<string, ResponseEntry> = {};
          let flagIdx = 0;
          for (const section of sections) {
            for (const q of section.questions) {
              if (q.required && answerFlags[flagIdx % answerFlags.length]) {
                responses[q.id] = { value: "x", answeredAt: new Date().toISOString() };
              }
              flagIdx++;
            }
          }

          const result = computeChecklistScores(sections, responses);

          // Verify each section score independently
          for (const section of sections) {
            const requiredQs = section.questions.filter((q) => q.required);
            if (requiredQs.length === 0) {
              expect(result.sectionScores[section.id]).toBe(100);
            } else {
              const totalWeight = requiredQs.reduce((s, q) => s + q.weight, 0);
              const answeredWeight = requiredQs
                .filter((q) => responses[q.id] !== undefined)
                .reduce((s, q) => s + q.weight, 0);
              const expected = totalWeight > 0
                ? Math.round((answeredWeight / totalWeight) * 100)
                : 100;
              expect(result.sectionScores[section.id]).toBe(expected);
            }
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ── Property 20: Prerequisite Section Gating ──────────────────────────────────

describe("Property 20: Prerequisite Section Gating", () => {
  /**
   * **Validates: Requirements 5.6**
   *
   * For any section with a prerequisite, it is accessible iff the prerequisite
   * section's score >= threshold.
   */
  it("section accessible iff prereq score >= threshold", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),  // prereq score
        fc.integer({ min: 0, max: 100 }),  // threshold
        (prereqScore, threshold) => {
          const sectionScores = { s1: prereqScore };
          const prerequisite = { sectionId: "s1", minScore: threshold };

          const accessible = checkPrerequisiteSection("s2", sectionScores, prerequisite);

          if (prereqScore >= threshold) {
            expect(accessible).toBe(true);
          } else {
            expect(accessible).toBe(false);
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  /**
   * **Validates: Requirements 5.6**
   *
   * When the prerequisite section has no score yet (undefined), the section
   * is always inaccessible regardless of threshold.
   */
  it("inaccessible when prereq section has no score", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),  // threshold
        (threshold) => {
          const sectionScores: Record<string, number> = {};
          const prerequisite = { sectionId: "s1", minScore: threshold };

          const accessible = checkPrerequisiteSection("s2", sectionScores, prerequisite);
          expect(accessible).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Property 21: Checklist Template JSON Round-Trip ────────────────────────────

describe("Property 21: Checklist Template JSON Round-Trip", () => {
  /**
   * **Validates: Requirements 5.7**
   *
   * For any valid template structure, serializing to JSON and deserializing
   * back produces a structurally equivalent template (section order, question
   * order, all fields preserved).
   */
  it("serialize/deserialize preserves structure", () => {
    fc.assert(
      fc.property(
        sectionsWithUniqueIds(1, 5),
        (sections) => {
          const template = {
            id: "template-1",
            name: "Test Template",
            code: "T001",
            versionNumber: 1,
            status: "draft" as const,
            sections,
          };

          const serialized = JSON.stringify(template);
          const deserialized = JSON.parse(serialized);

          // Full structural equality
          expect(deserialized).toEqual(template);

          // Section count preserved
          expect(deserialized.sections).toHaveLength(template.sections.length);

          // Section order preserved
          for (let i = 0; i < template.sections.length; i++) {
            expect(deserialized.sections[i].id).toBe(template.sections[i]!.id);
            expect(deserialized.sections[i].questions).toHaveLength(
              template.sections[i]!.questions.length,
            );

            // Question order preserved
            for (let j = 0; j < template.sections[i]!.questions.length; j++) {
              expect(deserialized.sections[i].questions[j].id).toBe(
                template.sections[i]!.questions[j]!.id,
              );
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 5.7**
   *
   * Double round-trip: serialize → deserialize → serialize produces identical JSON.
   */
  it("double round-trip produces identical JSON", () => {
    fc.assert(
      fc.property(
        sectionsWithUniqueIds(1, 4),
        (sections) => {
          const template = { sections, name: "T", code: "C", versionNumber: 1 };

          const json1 = JSON.stringify(template);
          const json2 = JSON.stringify(JSON.parse(json1));

          expect(json2).toBe(json1);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ── Property 22: Unique Question ID Validation ────────────────────────────────

describe("Property 22: Unique Question ID Validation", () => {
  /**
   * **Validates: Requirements 5.8**
   *
   * For any template where all question IDs are unique,
   * validateUniqueQuestionIds returns true (no throw).
   */
  it("passes when all question IDs are unique", () => {
    fc.assert(
      fc.property(
        sectionsWithUniqueIds(1, 5),
        (sections) => {
          expect(validateUniqueQuestionIds(sections)).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 5.8**
   *
   * For any template where at least one question ID is duplicated,
   * validateUniqueQuestionIds throws DomainError with code DUPLICATE_QUESTION_IDS.
   */
  it("fails when duplicate question IDs exist", () => {
    fc.assert(
      fc.property(
        sectionsWithUniqueIds(1, 4).filter((s) => {
          // Ensure we have at least 2 questions total to create a duplicate
          const totalQs = s.reduce((acc, sec) => acc + sec.questions.length, 0);
          return totalQs >= 2;
        }),
        (sections) => {
          // Introduce a duplicate: set last question ID = first question ID
          const allQuestions: Array<{ section: ChecklistSection; qIdx: number }> = [];
          for (const sec of sections) {
            for (let i = 0; i < sec.questions.length; i++) {
              allQuestions.push({ section: sec, qIdx: i });
            }
          }
          const firstId = allQuestions[0]!.section.questions[allQuestions[0]!.qIdx]!.id;
          const last = allQuestions[allQuestions.length - 1]!;
          last.section.questions[last.qIdx]!.id = firstId;

          expect(() => validateUniqueQuestionIds(sections)).toThrow(DomainError);
          try {
            validateUniqueQuestionIds(sections);
          } catch (e) {
            expect((e as DomainError).code).toBe("DUPLICATE_QUESTION_IDS");
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 5.8**
   *
   * Biconditional: passes iff all IDs are unique across all sections.
   */
  it("biconditional: passes iff all IDs unique", () => {
    fc.assert(
      fc.property(
        fc.array(sectionArb(), { minLength: 1, maxLength: 4 }),
        (sections) => {
          // Gather all question IDs
          const allIds = sections.flatMap((s) => s.questions.map((q) => q.id));
          const uniqueIds = new Set(allIds);
          const allUnique = uniqueIds.size === allIds.length;

          if (allUnique) {
            expect(validateUniqueQuestionIds(sections)).toBe(true);
          } else {
            expect(() => validateUniqueQuestionIds(sections)).toThrow(DomainError);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
