/**
 * Unit tests for execution domain logic — inspection lifecycle state machine.
 * Pure functions — no mocks, no I/O, no DB.
 *
 * Validates: Requirements 8.1, 8.3, 8.4, 8.7
 */
import { describe, it, expect } from "vitest";
import {
  INSPECTION_STATES,
  INSPECTION_TRANSITIONS,
  assertValidTransition,
  validateCompletion,
  DomainError,
  type InspectionState,
} from "../src/modules/execution/domain.js";
import type { ChecklistSection } from "../src/modules/checklist/domain.js";

// ── Constants ─────────────────────────────────────────────────────────────────

describe("INSPECTION_STATES", () => {
  it("contains exactly 6 states", () => {
    expect(INSPECTION_STATES).toHaveLength(6);
  });

  it("contains all expected states in order", () => {
    expect(INSPECTION_STATES).toEqual([
      "scheduled",
      "in_progress",
      "paused",
      "completed",
      "under_review",
      "finalized",
    ]);
  });
});

describe("INSPECTION_TRANSITIONS", () => {
  it("scheduled allows only in_progress", () => {
    expect(INSPECTION_TRANSITIONS.scheduled).toEqual(["in_progress"]);
  });

  it("in_progress allows paused and completed", () => {
    expect(INSPECTION_TRANSITIONS.in_progress).toEqual(["paused", "completed"]);
  });

  it("paused allows only in_progress", () => {
    expect(INSPECTION_TRANSITIONS.paused).toEqual(["in_progress"]);
  });

  it("completed allows only under_review", () => {
    expect(INSPECTION_TRANSITIONS.completed).toEqual(["under_review"]);
  });

  it("under_review allows finalized and in_progress (return for revision)", () => {
    expect(INSPECTION_TRANSITIONS.under_review).toEqual(["finalized", "in_progress"]);
  });

  it("finalized is a terminal state with no transitions", () => {
    expect(INSPECTION_TRANSITIONS.finalized).toEqual([]);
  });

  it("has an entry for every state", () => {
    for (const state of INSPECTION_STATES) {
      expect(INSPECTION_TRANSITIONS).toHaveProperty(state);
    }
  });
});

// ── assertValidTransition ─────────────────────────────────────────────────────

describe("assertValidTransition", () => {
  describe("valid transitions", () => {
    it("scheduled → in_progress", () => {
      expect(() => assertValidTransition("scheduled", "in_progress")).not.toThrow();
    });

    it("in_progress → paused", () => {
      expect(() => assertValidTransition("in_progress", "paused")).not.toThrow();
    });

    it("in_progress → completed", () => {
      expect(() => assertValidTransition("in_progress", "completed")).not.toThrow();
    });

    it("paused → in_progress", () => {
      expect(() => assertValidTransition("paused", "in_progress")).not.toThrow();
    });

    it("completed → under_review", () => {
      expect(() => assertValidTransition("completed", "under_review")).not.toThrow();
    });

    it("under_review → finalized", () => {
      expect(() => assertValidTransition("under_review", "finalized")).not.toThrow();
    });

    it("under_review → in_progress (return for revision)", () => {
      expect(() => assertValidTransition("under_review", "in_progress")).not.toThrow();
    });
  });

  describe("invalid transitions", () => {
    it("scheduled → completed throws INVALID_TRANSITION", () => {
      expect(() => assertValidTransition("scheduled", "completed")).toThrow(DomainError);
    });

    it("scheduled → finalized throws INVALID_TRANSITION", () => {
      expect(() => assertValidTransition("scheduled", "finalized")).toThrow(DomainError);
    });

    it("in_progress → scheduled throws INVALID_TRANSITION", () => {
      expect(() => assertValidTransition("in_progress", "scheduled")).toThrow(DomainError);
    });

    it("in_progress → finalized throws INVALID_TRANSITION", () => {
      expect(() => assertValidTransition("in_progress", "finalized")).toThrow(DomainError);
    });

    it("paused → completed throws INVALID_TRANSITION", () => {
      expect(() => assertValidTransition("paused", "completed")).toThrow(DomainError);
    });

    it("completed → finalized throws INVALID_TRANSITION", () => {
      expect(() => assertValidTransition("completed", "finalized")).toThrow(DomainError);
    });

    it("finalized → any state throws INVALID_TRANSITION", () => {
      for (const state of INSPECTION_STATES) {
        if (state === "finalized") continue;
        expect(() => assertValidTransition("finalized", state)).toThrow(DomainError);
      }
    });

    it("same-state transition throws INVALID_TRANSITION", () => {
      expect(() => assertValidTransition("in_progress", "in_progress")).toThrow(DomainError);
    });
  });

  describe("error details", () => {
    it("error code is INVALID_TRANSITION", () => {
      try {
        assertValidTransition("scheduled", "finalized");
      } catch (e) {
        expect(e).toBeInstanceOf(DomainError);
        expect((e as DomainError).code).toBe("INVALID_TRANSITION");
      }
    });

    it("error message includes current and target states", () => {
      expect(() => assertValidTransition("scheduled", "finalized")).toThrow("scheduled");
      expect(() => assertValidTransition("scheduled", "finalized")).toThrow("finalized");
    });

    it("error message includes allowed transitions", () => {
      expect(() => assertValidTransition("scheduled", "finalized")).toThrow("in_progress");
    });
  });
});

// ── validateCompletion ────────────────────────────────────────────────────────

describe("validateCompletion", () => {
  const makeSection = (questions: { id: string; required: boolean }[]): ChecklistSection => ({
    id: "section-1",
    title: "Test Section",
    sortOrder: 1,
    weight: 1,
    questions: questions.map((q, i) => ({
      id: q.id,
      text: `Question ${q.id}`,
      fieldType: "text" as const,
      sortOrder: i + 1,
      weight: 1,
      required: q.required,
    })),
  });

  const makeResponse = (questionId: string) => ({
    [questionId]: { value: "answered", answeredAt: "2025-01-01T00:00:00Z" },
  });

  it("returns valid when all required questions answered and evidence sufficient", () => {
    const sections = [makeSection([{ id: "q1", required: true }])];
    const responses = makeResponse("q1");
    const result = validateCompletion(sections, responses, 2, 2);
    expect(result.valid).toBe(true);
    expect(result.missingItems).toHaveLength(0);
  });

  it("returns invalid when required question is unanswered", () => {
    const sections = [makeSection([{ id: "q1", required: true }, { id: "q2", required: true }])];
    const responses = makeResponse("q1"); // q2 not answered
    const result = validateCompletion(sections, responses, 2, 2);
    expect(result.valid).toBe(false);
    expect(result.missingItems).toContain("question:q2");
  });

  it("returns invalid when evidence count is below required", () => {
    const sections = [makeSection([{ id: "q1", required: true }])];
    const responses = makeResponse("q1");
    const result = validateCompletion(sections, responses, 1, 3);
    expect(result.valid).toBe(false);
    expect(result.missingItems.some((item) => item.startsWith("evidence:"))).toBe(true);
  });

  it("returns invalid with both missing questions and evidence", () => {
    const sections = [makeSection([{ id: "q1", required: true }])];
    const responses = {}; // nothing answered
    const result = validateCompletion(sections, responses, 0, 1);
    expect(result.valid).toBe(false);
    expect(result.missingItems.length).toBeGreaterThanOrEqual(2);
  });

  it("ignores optional questions for completion", () => {
    const sections = [
      makeSection([
        { id: "q1", required: true },
        { id: "q2", required: false },
      ]),
    ];
    const responses = makeResponse("q1"); // q2 is optional, not answered
    const result = validateCompletion(sections, responses, 1, 1);
    expect(result.valid).toBe(true);
  });

  it("returns valid with zero required evidence when none required", () => {
    const sections = [makeSection([{ id: "q1", required: true }])];
    const responses = makeResponse("q1");
    const result = validateCompletion(sections, responses, 0, 0);
    expect(result.valid).toBe(true);
  });

  it("handles multiple sections", () => {
    const sections = [
      makeSection([{ id: "q1", required: true }]),
      {
        id: "section-2",
        title: "Section 2",
        sortOrder: 2,
        weight: 1,
        questions: [
          { id: "q2", text: "Q2", fieldType: "boolean" as const, sortOrder: 1, weight: 1, required: true },
        ],
      },
    ];
    const responses = { ...makeResponse("q1"), ...makeResponse("q2") };
    const result = validateCompletion(sections, responses, 1, 1);
    expect(result.valid).toBe(true);
  });

  it("handles empty sections array", () => {
    const result = validateCompletion([], {}, 1, 1);
    expect(result.valid).toBe(true);
  });
});
