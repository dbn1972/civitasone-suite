/**
 * Property-based tests for execution domain logic.
 *
 * **Property 28: Inspection State Machine Validity** — assertValidTransition passes iff target in INSPECTION_TRANSITIONS[current]
 * **Property 29: Completion Validation** — valid=true iff all required questions answered AND evidence count ≥ minimum
 *
 * Pure functions — no mocks, no I/O, no DB.
 *
 * **Validates: Requirements 8.1, 8.3**
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  INSPECTION_STATES,
  INSPECTION_TRANSITIONS,
  assertValidTransition,
  validateCompletion,
  DomainError,
  type InspectionState,
} from "../src/modules/execution/domain.js";
import type { ChecklistSection, ChecklistQuestion } from "../src/modules/checklist/domain.js";

// ── Arbitraries ───────────────────────────────────────────────────────────────

/** Arbitrary that produces any valid InspectionState. */
const inspectionStateArb: fc.Arbitrary<InspectionState> = fc.constantFrom(...INSPECTION_STATES);

/** Arbitrary for a valid field type. */
const fieldTypeArb = fc.constantFrom(
  "text" as const,
  "number" as const,
  "boolean" as const,
  "select" as const,
  "multi_select" as const,
  "photo" as const,
  "signature" as const,
  "geo_point" as const,
);

/** Arbitrary for a checklist question. */
const questionArb = (opts: { required?: boolean } = {}): fc.Arbitrary<ChecklistQuestion> =>
  fc.record({
    id: fc.uuid(),
    text: fc.string({ minLength: 1, maxLength: 50 }),
    fieldType: fieldTypeArb,
    sortOrder: fc.integer({ min: 1, max: 100 }),
    weight: fc.double({ min: 0.1, max: 10, noNaN: true, noDefaultInfinity: true }),
    required: opts.required !== undefined ? fc.constant(opts.required) : fc.boolean(),
  });

/** Arbitrary for a checklist section with configurable questions. */
const sectionArb = (questionCount: { min: number; max: number } = { min: 1, max: 5 }): fc.Arbitrary<ChecklistSection> =>
  fc.record({
    id: fc.uuid(),
    title: fc.string({ minLength: 1, maxLength: 30 }),
    sortOrder: fc.integer({ min: 1, max: 20 }),
    weight: fc.double({ min: 0.1, max: 10, noNaN: true, noDefaultInfinity: true }),
    questions: fc.array(questionArb(), { minLength: questionCount.min, maxLength: questionCount.max }),
  });

// ── Property 28: Inspection State Machine Validity ────────────────────────────

describe("Property 28: Inspection State Machine Validity", () => {
  /**
   * **Validates: Requirements 8.1**
   *
   * For any (current, target) pair where target IS in INSPECTION_TRANSITIONS[current],
   * assertValidTransition must NOT throw.
   */
  it("assertValidTransition passes when target is in INSPECTION_TRANSITIONS[current]", () => {
    // Build all valid (current, target) pairs
    const validPairs: Array<{ current: InspectionState; target: InspectionState }> = [];
    for (const state of INSPECTION_STATES) {
      for (const target of INSPECTION_TRANSITIONS[state]) {
        validPairs.push({ current: state, target });
      }
    }

    // Need at least one valid pair to test
    expect(validPairs.length).toBeGreaterThan(0);

    fc.assert(
      fc.property(
        fc.constantFrom(...validPairs),
        ({ current, target }) => {
          // Should not throw for valid transitions
          expect(() => assertValidTransition(current, target)).not.toThrow();
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 8.1**
   *
   * For any (current, target) pair where target is NOT in INSPECTION_TRANSITIONS[current],
   * assertValidTransition must throw a DomainError with code INVALID_TRANSITION.
   */
  it("assertValidTransition throws when target is NOT in INSPECTION_TRANSITIONS[current]", () => {
    fc.assert(
      fc.property(
        inspectionStateArb,
        inspectionStateArb,
        (current, target) => {
          const allowed = INSPECTION_TRANSITIONS[current];
          // Only test invalid transitions
          fc.pre(!allowed.includes(target));

          expect(() => assertValidTransition(current, target)).toThrow(DomainError);
          try {
            assertValidTransition(current, target);
          } catch (e) {
            expect((e as DomainError).code).toBe("INVALID_TRANSITION");
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  /**
   * **Validates: Requirements 8.1**
   *
   * Biconditional: assertValidTransition passes iff target in INSPECTION_TRANSITIONS[current].
   * This is the complete state machine correctness property.
   */
  it("passes iff target in INSPECTION_TRANSITIONS[current] (biconditional)", () => {
    fc.assert(
      fc.property(
        inspectionStateArb,
        inspectionStateArb,
        (current, target) => {
          const allowed = INSPECTION_TRANSITIONS[current];
          const isValid = allowed.includes(target);

          if (isValid) {
            expect(() => assertValidTransition(current, target)).not.toThrow();
          } else {
            expect(() => assertValidTransition(current, target)).toThrow(DomainError);
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  /**
   * **Validates: Requirements 8.1**
   *
   * The finalized state is terminal — no transitions are allowed from it.
   */
  it("finalized is terminal: all transitions from finalized are rejected", () => {
    fc.assert(
      fc.property(
        inspectionStateArb,
        (target) => {
          expect(() => assertValidTransition("finalized", target)).toThrow(DomainError);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Property 29: Completion Validation ────────────────────────────────────────

describe("Property 29: Completion Validation", () => {
  /**
   * **Validates: Requirements 8.3**
   *
   * When all required questions are answered AND evidence count ≥ minimum,
   * validateCompletion returns valid = true.
   */
  it("valid=true when all required questions answered AND evidence ≥ minimum", () => {
    fc.assert(
      fc.property(
        fc.array(sectionArb(), { minLength: 0, maxLength: 5 }),
        fc.integer({ min: 0, max: 20 }),
        (sections, extraEvidence) => {
          // Build responses for ALL required questions
          const responses: Record<string, { value: unknown; answeredAt: string }> = {};
          let requiredCount = 0;

          for (const section of sections) {
            for (const question of section.questions) {
              if (question.required) {
                responses[question.id] = { value: "answer", answeredAt: "2025-01-01T00:00:00Z" };
                requiredCount++;
              }
            }
          }

          // Evidence meets or exceeds required
          const requiredEvidence = Math.max(0, requiredCount > 0 ? 1 : 0);
          const evidenceCount = requiredEvidence + extraEvidence;

          const result = validateCompletion(sections, responses, evidenceCount, requiredEvidence);
          expect(result.valid).toBe(true);
          expect(result.missingItems).toHaveLength(0);
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 8.3**
   *
   * When at least one required question is NOT answered (even if evidence is sufficient),
   * validateCompletion returns valid = false.
   */
  it("valid=false when at least one required question is unanswered", () => {
    fc.assert(
      fc.property(
        // Generate sections that have at least one required question
        fc.array(sectionArb(), { minLength: 1, maxLength: 4 }).filter((sections) =>
          sections.some((s) => s.questions.some((q) => q.required)),
        ),
        fc.integer({ min: 0, max: 10 }),
        (sections, extraEvidence) => {
          // Collect all required question ids
          const requiredIds: string[] = [];
          for (const section of sections) {
            for (const question of section.questions) {
              if (question.required) {
                requiredIds.push(question.id);
              }
            }
          }

          // Must have at least one required question
          fc.pre(requiredIds.length > 0);

          // Answer all required questions EXCEPT the last one
          const responses: Record<string, { value: unknown; answeredAt: string }> = {};
          for (let i = 0; i < requiredIds.length - 1; i++) {
            responses[requiredIds[i]!] = { value: "answer", answeredAt: "2025-01-01T00:00:00Z" };
          }

          // Evidence is sufficient
          const result = validateCompletion(sections, responses, extraEvidence + 10, 0);
          expect(result.valid).toBe(false);
          expect(result.missingItems.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 8.3**
   *
   * When evidence count < required minimum (even if all questions answered),
   * validateCompletion returns valid = false.
   */
  it("valid=false when evidence count < required minimum", () => {
    fc.assert(
      fc.property(
        fc.array(sectionArb(), { minLength: 0, maxLength: 4 }),
        fc.integer({ min: 1, max: 20 }),
        (sections, requiredEvidence) => {
          // Answer ALL required questions
          const responses: Record<string, { value: unknown; answeredAt: string }> = {};
          for (const section of sections) {
            for (const question of section.questions) {
              if (question.required) {
                responses[question.id] = { value: "answer", answeredAt: "2025-01-01T00:00:00Z" };
              }
            }
          }

          // Evidence is strictly less than required
          const evidenceCount = fc.sample(fc.integer({ min: 0, max: requiredEvidence - 1 }), 1)[0]!;

          const result = validateCompletion(sections, responses, evidenceCount, requiredEvidence);
          expect(result.valid).toBe(false);
          expect(result.missingItems.some((item) => item.startsWith("evidence:"))).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 8.3**
   *
   * Biconditional: valid=true iff all required questions answered AND evidence ≥ minimum.
   * This is the complete correctness property.
   */
  it("valid=true iff all required answered AND evidence ≥ minimum (biconditional)", () => {
    fc.assert(
      fc.property(
        fc.array(sectionArb(), { minLength: 0, maxLength: 4 }),
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 0, max: 10 }),
        (sections, evidenceCount, requiredEvidence) => {
          // Randomly decide which required questions to answer
          const requiredIds: string[] = [];
          for (const section of sections) {
            for (const question of section.questions) {
              if (question.required) {
                requiredIds.push(question.id);
              }
            }
          }

          // Answer a random subset of required questions
          const answeredSet = new Set(
            fc.sample(fc.subarray(requiredIds, { minLength: 0, maxLength: requiredIds.length }), 1)[0]!,
          );

          const responses: Record<string, { value: unknown; answeredAt: string }> = {};
          for (const id of answeredSet) {
            responses[id] = { value: "answer", answeredAt: "2025-01-01T00:00:00Z" };
          }

          const allRequiredAnswered = requiredIds.every((id) => answeredSet.has(id));
          const evidenceSufficient = evidenceCount >= requiredEvidence;
          const shouldBeValid = allRequiredAnswered && evidenceSufficient;

          const result = validateCompletion(sections, responses, evidenceCount, requiredEvidence);
          expect(result.valid).toBe(shouldBeValid);
        },
      ),
      { numRuns: 500 },
    );
  });

  /**
   * **Validates: Requirements 8.3**
   *
   * Optional questions do not affect completion validation — only required questions matter.
   */
  it("optional questions have no effect on validity", () => {
    fc.assert(
      fc.property(
        // Generate sections with a mix of required and optional questions
        fc.array(
          fc.record({
            id: fc.uuid(),
            title: fc.string({ minLength: 1, maxLength: 20 }),
            sortOrder: fc.integer({ min: 1, max: 10 }),
            weight: fc.constant(1),
            questions: fc.tuple(
              // One required question
              questionArb({ required: true }),
              // One optional question
              questionArb({ required: false }),
            ).map(([req, opt]) => [req, opt]),
          }) as fc.Arbitrary<ChecklistSection>,
          { minLength: 1, maxLength: 3 },
        ),
        (sections) => {
          // Answer ONLY required questions
          const responses: Record<string, { value: unknown; answeredAt: string }> = {};
          for (const section of sections) {
            for (const question of section.questions) {
              if (question.required) {
                responses[question.id] = { value: "answer", answeredAt: "2025-01-01T00:00:00Z" };
              }
            }
          }

          // With sufficient evidence, should be valid even though optional questions are unanswered
          const result = validateCompletion(sections, responses, 5, 1);
          expect(result.valid).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});
