/**
 * Unit tests for SVC-109 Field Staff Routing — TA/DA integration and tour plan approval.
 * Tests pure domain logic: state transitions, maker-checker, travel summary computation.
 *
 * Validates: Tour plan states, assertValidTourPlanTransition, assertMakerCheckerApproval,
 *            computeTravelSummary
 */
import { describe, it, expect } from "vitest";
import {
  TOUR_PLAN_STATES,
  TOUR_PLAN_TRANSITIONS,
  assertValidTourPlanTransition,
  assertMakerCheckerApproval,
  DomainError,
  type TourPlanState,
} from "../src/modules/assignment/domain.js";
import {
  computeTravelSummary,
  type GeoAttendanceRecord,
} from "../src/modules/assignment/tada-integration.js";

// ── Tour Plan State Machine ───────────────────────────────────────────────────

describe("TOUR_PLAN_STATES", () => {
  it("defines exactly 4 states", () => {
    expect(TOUR_PLAN_STATES).toHaveLength(4);
  });

  it("includes draft, submitted, approved, rejected", () => {
    expect(TOUR_PLAN_STATES).toContain("draft");
    expect(TOUR_PLAN_STATES).toContain("submitted");
    expect(TOUR_PLAN_STATES).toContain("approved");
    expect(TOUR_PLAN_STATES).toContain("rejected");
  });
});

describe("TOUR_PLAN_TRANSITIONS", () => {
  it("allows draft → submitted", () => {
    expect(TOUR_PLAN_TRANSITIONS.draft).toContain("submitted");
  });

  it("allows submitted → approved", () => {
    expect(TOUR_PLAN_TRANSITIONS.submitted).toContain("approved");
  });

  it("allows submitted → rejected", () => {
    expect(TOUR_PLAN_TRANSITIONS.submitted).toContain("rejected");
  });

  it("allows rejected → draft", () => {
    expect(TOUR_PLAN_TRANSITIONS.rejected).toContain("draft");
  });

  it("approved is a terminal state (no transitions)", () => {
    expect(TOUR_PLAN_TRANSITIONS.approved).toHaveLength(0);
  });

  it("draft cannot transition directly to approved", () => {
    expect(TOUR_PLAN_TRANSITIONS.draft).not.toContain("approved");
  });

  it("draft cannot transition directly to rejected", () => {
    expect(TOUR_PLAN_TRANSITIONS.draft).not.toContain("rejected");
  });
});

// ── assertValidTourPlanTransition ─────────────────────────────────────────────

describe("assertValidTourPlanTransition", () => {
  // Valid transitions
  it("passes for draft → submitted", () => {
    expect(assertValidTourPlanTransition("draft", "submitted")).toBe(true);
  });

  it("passes for submitted → approved", () => {
    expect(assertValidTourPlanTransition("submitted", "approved")).toBe(true);
  });

  it("passes for submitted → rejected", () => {
    expect(assertValidTourPlanTransition("submitted", "rejected")).toBe(true);
  });

  it("passes for rejected → draft", () => {
    expect(assertValidTourPlanTransition("rejected", "draft")).toBe(true);
  });

  // Invalid transitions
  it("throws for draft → approved (must go through submitted)", () => {
    expect(() => assertValidTourPlanTransition("draft", "approved")).toThrow(DomainError);
  });

  it("throws for draft → rejected (must go through submitted)", () => {
    expect(() => assertValidTourPlanTransition("draft", "rejected")).toThrow(DomainError);
  });

  it("throws for approved → draft (terminal state)", () => {
    expect(() => assertValidTourPlanTransition("approved", "draft")).toThrow(DomainError);
  });

  it("throws for approved → submitted (terminal state)", () => {
    expect(() => assertValidTourPlanTransition("approved", "submitted")).toThrow(DomainError);
  });

  it("throws for approved → rejected (terminal state)", () => {
    expect(() => assertValidTourPlanTransition("approved", "rejected")).toThrow(DomainError);
  });

  it("throws for rejected → approved (must go through draft → submitted)", () => {
    expect(() => assertValidTourPlanTransition("rejected", "approved")).toThrow(DomainError);
  });

  it("throws for rejected → submitted (must revert to draft first)", () => {
    expect(() => assertValidTourPlanTransition("rejected", "submitted")).toThrow(DomainError);
  });

  it("error includes code INVALID_TOUR_PLAN_TRANSITION", () => {
    try {
      assertValidTourPlanTransition("draft", "approved");
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("INVALID_TOUR_PLAN_TRANSITION");
    }
  });

  it("error message includes current and target state", () => {
    try {
      assertValidTourPlanTransition("approved", "draft");
    } catch (e) {
      expect((e as DomainError).message).toContain("approved");
      expect((e as DomainError).message).toContain("draft");
    }
  });

  it("error details include allowed transitions", () => {
    try {
      assertValidTourPlanTransition("draft", "approved");
    } catch (e) {
      const details = (e as DomainError).details;
      expect(details).toBeDefined();
      expect(details!["current"]).toBe("draft");
      expect(details!["target"]).toBe("approved");
      expect(details!["allowed"]).toEqual(["submitted"]);
    }
  });

  // Full lifecycle test
  it("supports the full happy path: draft → submitted → approved", () => {
    expect(assertValidTourPlanTransition("draft", "submitted")).toBe(true);
    expect(assertValidTourPlanTransition("submitted", "approved")).toBe(true);
  });

  it("supports the rejection and revision path: draft → submitted → rejected → draft", () => {
    expect(assertValidTourPlanTransition("draft", "submitted")).toBe(true);
    expect(assertValidTourPlanTransition("submitted", "rejected")).toBe(true);
    expect(assertValidTourPlanTransition("rejected", "draft")).toBe(true);
  });
});

// ── assertMakerCheckerApproval ────────────────────────────────────────────────

describe("assertMakerCheckerApproval", () => {
  it("passes when approver is different from creator", () => {
    expect(assertMakerCheckerApproval("user-a", "user-b")).toBe(true);
  });

  it("throws when approver is the same as creator", () => {
    expect(() => assertMakerCheckerApproval("user-a", "user-a")).toThrow(DomainError);
  });

  it("error has code MAKER_CHECKER_VIOLATION", () => {
    try {
      assertMakerCheckerApproval("same-user", "same-user");
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("MAKER_CHECKER_VIOLATION");
    }
  });

  it("error message mentions self-approval", () => {
    try {
      assertMakerCheckerApproval("user-x", "user-x");
    } catch (e) {
      expect((e as DomainError).message).toContain("same person");
    }
  });

  it("error details include both IDs", () => {
    try {
      assertMakerCheckerApproval("creator-1", "creator-1");
    } catch (e) {
      const details = (e as DomainError).details;
      expect(details).toBeDefined();
      expect(details!["creatorId"]).toBe("creator-1");
      expect(details!["approverId"]).toBe("creator-1");
    }
  });

  it("comparison is case-sensitive", () => {
    // Different casing = different users
    expect(assertMakerCheckerApproval("User-A", "user-a")).toBe(true);
  });
});

// ── computeTravelSummary ──────────────────────────────────────────────────────

describe("computeTravelSummary", () => {
  function makeRecord(overrides: Partial<GeoAttendanceRecord> & { id: string }): GeoAttendanceRecord {
    return {
      inspectorId: "inspector-1",
      latitude: "28.6139",
      longitude: "77.2090",
      entityLatitude: "28.6200",
      entityLongitude: "77.2100",
      distanceMeters: 500,
      createdAt: "2025-07-15T09:00:00Z",
      inspectionId: "insp-1",
      ...overrides,
    };
  }

  it("returns zero summary for empty records", () => {
    const result = computeTravelSummary([]);
    expect(result.totalDistanceMeters).toBe(0);
    expect(result.locationsVisited).toBe(0);
    expect(result.locations).toHaveLength(0);
  });

  it("sums total distance across all records", () => {
    const records = [
      makeRecord({ id: "1", distanceMeters: 500 }),
      makeRecord({ id: "2", distanceMeters: 1200 }),
      makeRecord({ id: "3", distanceMeters: 800 }),
    ];
    const result = computeTravelSummary(records);
    expect(result.totalDistanceMeters).toBe(2500);
  });

  it("counts unique locations visited (by entity coordinates)", () => {
    const records = [
      makeRecord({ id: "1", entityLatitude: "28.62", entityLongitude: "77.21" }),
      makeRecord({ id: "2", entityLatitude: "28.63", entityLongitude: "77.22" }),
      makeRecord({ id: "3", entityLatitude: "28.62", entityLongitude: "77.21" }), // duplicate
    ];
    const result = computeTravelSummary(records);
    expect(result.locationsVisited).toBe(2);
  });

  it("returns all unique location coordinates", () => {
    const records = [
      makeRecord({ id: "1", entityLatitude: "28.62", entityLongitude: "77.21" }),
      makeRecord({ id: "2", entityLatitude: "28.63", entityLongitude: "77.22" }),
    ];
    const result = computeTravelSummary(records);
    expect(result.locations).toHaveLength(2);
    expect(result.locations).toContainEqual({ latitude: "28.62", longitude: "77.21" });
    expect(result.locations).toContainEqual({ latitude: "28.63", longitude: "77.22" });
  });

  it("handles single record correctly", () => {
    const records = [makeRecord({ id: "1", distanceMeters: 750 })];
    const result = computeTravelSummary(records);
    expect(result.totalDistanceMeters).toBe(750);
    expect(result.locationsVisited).toBe(1);
    expect(result.locations).toHaveLength(1);
  });

  it("handles records with zero distance", () => {
    const records = [
      makeRecord({ id: "1", distanceMeters: 0 }),
      makeRecord({ id: "2", distanceMeters: 0, entityLatitude: "28.63", entityLongitude: "77.22" }),
    ];
    const result = computeTravelSummary(records);
    expect(result.totalDistanceMeters).toBe(0);
    expect(result.locationsVisited).toBe(2);
  });
});
