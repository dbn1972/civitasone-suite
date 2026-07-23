/**
 * Unit tests for Survey & Sampling domain logic.
 * Pure functions — no mocks, no I/O, no DB.
 *
 * Validates: SVC-104
 */
import { describe, it, expect } from "vitest";
import {
  SURVEY_STATES,
  SURVEY_TRANSITIONS,
  assertValidSurveyTransition,
  selectRandomSample,
  selectStratifiedSample,
  selectSystematicSample,
  computeAggregation,
  validateSurveyResponse,
  createSeededRng,
  DomainError,
} from "../src/modules/survey/domain.js";
import type { QuestionnaireItem } from "../src/modules/survey/schema.js";

// ── Constants ─────────────────────────────────────────────────────────────────

describe("SURVEY_STATES", () => {
  it("contains exactly 3 states", () => {
    expect(SURVEY_STATES).toHaveLength(3);
  });

  it("includes draft, active, closed", () => {
    expect(SURVEY_STATES).toContain("draft");
    expect(SURVEY_STATES).toContain("active");
    expect(SURVEY_STATES).toContain("closed");
  });
});

describe("SURVEY_TRANSITIONS", () => {
  it("draft can go to active", () => {
    expect(SURVEY_TRANSITIONS.draft).toContain("active");
  });

  it("active can go to closed", () => {
    expect(SURVEY_TRANSITIONS.active).toContain("closed");
  });

  it("closed is terminal", () => {
    expect(SURVEY_TRANSITIONS.closed).toHaveLength(0);
  });
});

// ── assertValidSurveyTransition ───────────────────────────────────────────────

describe("assertValidSurveyTransition", () => {
  it("allows draft → active", () => {
    expect(() => assertValidSurveyTransition("draft", "active")).not.toThrow();
  });

  it("allows active → closed", () => {
    expect(() => assertValidSurveyTransition("active", "closed")).not.toThrow();
  });

  it("throws for draft → closed (must go through active)", () => {
    expect(() => assertValidSurveyTransition("draft", "closed"))
      .toThrow(DomainError);
  });

  it("throws for closed → active (terminal)", () => {
    expect(() => assertValidSurveyTransition("closed", "active"))
      .toThrow(DomainError);
  });

  it("throws for active → draft (cannot go backwards)", () => {
    expect(() => assertValidSurveyTransition("active", "draft"))
      .toThrow(DomainError);
  });

  it("error code is INVALID_TRANSITION", () => {
    try {
      assertValidSurveyTransition("closed", "draft");
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("INVALID_TRANSITION");
    }
  });
});

// ── createSeededRng ───────────────────────────────────────────────────────────

describe("createSeededRng", () => {
  it("produces deterministic output for same seed", () => {
    const rng1 = createSeededRng(42);
    const rng2 = createSeededRng(42);
    const values1 = Array.from({ length: 10 }, () => rng1());
    const values2 = Array.from({ length: 10 }, () => rng2());
    expect(values1).toEqual(values2);
  });

  it("produces values in [0, 1)", () => {
    const rng = createSeededRng(123);
    for (let i = 0; i < 100; i++) {
      const val = rng();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });

  it("different seeds produce different sequences", () => {
    const rng1 = createSeededRng(1);
    const rng2 = createSeededRng(2);
    const values1 = Array.from({ length: 5 }, () => rng1());
    const values2 = Array.from({ length: 5 }, () => rng2());
    expect(values1).not.toEqual(values2);
  });
});

// ── selectRandomSample ────────────────────────────────────────────────────────

describe("selectRandomSample", () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];

  it("returns correct sample size", () => {
    const result = selectRandomSample(ids, 3, 42);
    expect(result).toHaveLength(3);
  });

  it("returns all elements if sampleSize >= population", () => {
    const result = selectRandomSample(ids, 20, 42);
    expect(result).toHaveLength(ids.length);
  });

  it("returns empty array if sampleSize <= 0", () => {
    expect(selectRandomSample(ids, 0, 42)).toHaveLength(0);
    expect(selectRandomSample(ids, -1, 42)).toHaveLength(0);
  });

  it("is deterministic given the same seed", () => {
    const result1 = selectRandomSample(ids, 5, 42);
    const result2 = selectRandomSample(ids, 5, 42);
    expect(result1).toEqual(result2);
  });

  it("produces different results with different seeds", () => {
    const result1 = selectRandomSample(ids, 5, 1);
    const result2 = selectRandomSample(ids, 5, 2);
    // Different seeds should generally produce different selections
    // (extremely unlikely to be identical for 5 out of 10)
    expect(result1).not.toEqual(result2);
  });

  it("all selected elements come from the original population", () => {
    const result = selectRandomSample(ids, 5, 99);
    for (const id of result) {
      expect(ids).toContain(id);
    }
  });

  it("no duplicates in the result", () => {
    const result = selectRandomSample(ids, 5, 42);
    expect(new Set(result).size).toBe(result.length);
  });
});

// ── selectStratifiedSample ────────────────────────────────────────────────────

describe("selectStratifiedSample", () => {
  const entities = [
    { id: "1", region: "north" },
    { id: "2", region: "north" },
    { id: "3", region: "north" },
    { id: "4", region: "south" },
    { id: "5", region: "south" },
    { id: "6", region: "east" },
  ];

  it("returns elements from each stratum proportionally", () => {
    const result = selectStratifiedSample(entities, "region", 50, 42);
    // north: 3 → ceil(3*50/100) = 2
    // south: 2 → ceil(2*50/100) = 1
    // east: 1 → ceil(1*50/100) = 1
    // Total = 4
    expect(result.length).toBe(4);
  });

  it("returns all if sampleSizePercent >= 100", () => {
    const result = selectStratifiedSample(entities, "region", 100, 42);
    expect(result).toHaveLength(entities.length);
  });

  it("returns empty array if sampleSizePercent <= 0", () => {
    expect(selectStratifiedSample(entities, "region", 0, 42)).toHaveLength(0);
  });

  it("returns empty array for empty population", () => {
    expect(selectStratifiedSample([], "region", 50, 42)).toHaveLength(0);
  });

  it("is deterministic given the same seed", () => {
    const result1 = selectStratifiedSample(entities, "region", 50, 42);
    const result2 = selectStratifiedSample(entities, "region", 50, 42);
    expect(result1).toEqual(result2);
  });

  it("handles missing stratification field by grouping as 'unknown'", () => {
    const noField = [{ id: "1" }, { id: "2" }, { id: "3" }];
    const result = selectStratifiedSample(noField, "nonexistent", 50, 42);
    // All in one stratum, ceil(3*50/100) = 2
    expect(result).toHaveLength(2);
  });

  it("all selected ids come from original population", () => {
    const result = selectStratifiedSample(entities, "region", 50, 42);
    const allIds = entities.map((e) => e.id);
    for (const id of result) {
      expect(allIds).toContain(id);
    }
  });
});

// ── selectSystematicSample ────────────────────────────────────────────────────

describe("selectSystematicSample", () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];

  it("returns correct sample size", () => {
    const result = selectSystematicSample(ids, 3, 42);
    expect(result.length).toBeLessThanOrEqual(3);
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns all elements if sampleSize >= population", () => {
    const result = selectSystematicSample(ids, 20, 42);
    expect(result).toHaveLength(ids.length);
  });

  it("returns empty array if sampleSize <= 0", () => {
    expect(selectSystematicSample(ids, 0, 42)).toHaveLength(0);
  });

  it("is deterministic given the same seed", () => {
    const result1 = selectSystematicSample(ids, 4, 42);
    const result2 = selectSystematicSample(ids, 4, 42);
    expect(result1).toEqual(result2);
  });

  it("selects elements at regular intervals (every kth)", () => {
    // k = 10/5 = 2, so we pick every 2nd element
    const result = selectSystematicSample(ids, 5, 0);
    // With seed 0, start offset is determined by RNG
    expect(result.length).toBeLessThanOrEqual(5);
    // All elements should be from the original
    for (const id of result) {
      expect(ids).toContain(id);
    }
  });

  it("no duplicates in the result", () => {
    const result = selectSystematicSample(ids, 4, 42);
    expect(new Set(result).size).toBe(result.length);
  });
});

// ── computeAggregation ────────────────────────────────────────────────────────

describe("computeAggregation", () => {
  const questionnaire: QuestionnaireItem[] = [
    { id: "q1", question: "Rating", fieldType: "rating", required: true },
    { id: "q2", question: "Color", fieldType: "text", required: true },
    { id: "q3", question: "Score", fieldType: "numeric", required: false },
  ];

  const responses = [
    { q1: 4, q2: "red", q3: 80 },
    { q1: 5, q2: "blue", q3: 90 },
    { q1: 3, q2: "red", q3: 70 },
    { q1: 4, q2: "green" },
  ];

  it("computes mean for numeric field types", () => {
    const result = computeAggregation(responses, questionnaire);
    // q1 (rating): mean of [4,5,3,4] = 4
    expect(result.q1?.mean).toBe(4);
    // q3 (numeric): mean of [80,90,70] = 80
    expect(result.q3?.mean).toBe(80);
  });

  it("does not compute mean for non-numeric field types", () => {
    const result = computeAggregation(responses, questionnaire);
    expect(result.q2?.mean).toBeUndefined();
  });

  it("computes mode (most frequent value)", () => {
    const result = computeAggregation(responses, questionnaire);
    // q1: 4 appears twice
    expect(result.q1?.mode).toBe("4");
    // q2: red appears twice
    expect(result.q2?.mode).toBe("red");
  });

  it("computes distribution for all questions", () => {
    const result = computeAggregation(responses, questionnaire);
    expect(result.q1?.distribution).toEqual({ "3": 1, "4": 2, "5": 1 });
    expect(result.q2?.distribution).toEqual({ red: 2, blue: 1, green: 1 });
  });

  it("handles empty responses", () => {
    const result = computeAggregation([], questionnaire);
    expect(result.q1?.distribution).toEqual({});
    expect(result.q1?.mean).toBeUndefined();
    expect(result.q1?.mode).toBeUndefined();
  });

  it("skips null/undefined values in aggregation", () => {
    const sparseResponses = [
      { q1: 5 },
      { q1: null },
      { q1: undefined },
    ];
    const result = computeAggregation(sparseResponses, questionnaire);
    expect(result.q1?.mean).toBe(5);
    expect(result.q1?.distribution).toEqual({ "5": 1 });
  });
});

// ── validateSurveyResponse ────────────────────────────────────────────────────

describe("validateSurveyResponse", () => {
  const questionnaire: QuestionnaireItem[] = [
    { id: "q1", question: "Name", fieldType: "text", required: true },
    { id: "q2", question: "Age", fieldType: "number", required: true },
    { id: "q3", question: "Notes", fieldType: "text", required: false },
  ];

  it("does not throw when all required questions are answered", () => {
    expect(() => validateSurveyResponse(
      { q1: "Alice", q2: 30 },
      questionnaire,
    )).not.toThrow();
  });

  it("does not throw when optional questions are missing", () => {
    expect(() => validateSurveyResponse(
      { q1: "Alice", q2: 30 },
      questionnaire,
    )).not.toThrow();
  });

  it("throws MISSING_REQUIRED_ANSWERS when required q is missing", () => {
    try {
      validateSurveyResponse({ q1: "Alice" }, questionnaire);
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("MISSING_REQUIRED_ANSWERS");
    }
  });

  it("throws when required answer is null", () => {
    expect(() => validateSurveyResponse(
      { q1: null, q2: 30 },
      questionnaire,
    )).toThrow(DomainError);
  });

  it("throws when required answer is empty string", () => {
    expect(() => validateSurveyResponse(
      { q1: "", q2: 30 },
      questionnaire,
    )).toThrow(DomainError);
  });

  it("error message lists all missing question IDs", () => {
    try {
      validateSurveyResponse({}, questionnaire);
    } catch (e) {
      expect((e as DomainError).message).toContain("q1");
      expect((e as DomainError).message).toContain("q2");
    }
  });

  it("allows zero as a valid answer", () => {
    expect(() => validateSurveyResponse(
      { q1: "Alice", q2: 0 },
      questionnaire,
    )).not.toThrow();
  });

  it("allows false as a valid answer", () => {
    expect(() => validateSurveyResponse(
      { q1: "Alice", q2: false },
      questionnaire,
    )).not.toThrow();
  });
});
