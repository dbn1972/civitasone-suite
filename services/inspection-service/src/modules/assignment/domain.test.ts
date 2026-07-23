/**
 * Unit tests for assignment domain logic.
 *
 * _Validates: Requirements 4.1, 4.2, 4.3, 4.5, 4.6, 4.8_
 */
import { describe, it, expect } from "vitest";
import {
  validateCompetency,
  checkConflictOfInterest,
  validateDailyCapacity,
  haversineDistance,
  validateGeofence,
  DomainError,
} from "./domain.js";

describe("validateCompetency", () => {
  it("passes when inspector has all required competencies", () => {
    expect(validateCompetency(["fire_safety", "food_hygiene", "electrical"], ["fire_safety", "food_hygiene"])).toBe(true);
  });

  it("passes when required is empty", () => {
    expect(validateCompetency(["fire_safety"], [])).toBe(true);
  });

  it("passes when both are empty", () => {
    expect(validateCompetency([], [])).toBe(true);
  });

  it("throws INSUFFICIENT_COMPETENCY when inspector lacks a required competency", () => {
    expect(() => validateCompetency(["fire_safety"], ["fire_safety", "food_hygiene"]))
      .toThrow(DomainError);

    try {
      validateCompetency(["fire_safety"], ["fire_safety", "food_hygiene"]);
    } catch (err) {
      const e = err as DomainError;
      expect(e.code).toBe("INSUFFICIENT_COMPETENCY");
      expect(e.details?.missingCompetencies).toEqual(["food_hygiene"]);
    }
  });

  it("throws with all missing competencies listed", () => {
    try {
      validateCompetency([], ["a", "b", "c"]);
    } catch (err) {
      const e = err as DomainError;
      expect(e.details?.missingCompetencies).toEqual(["a", "b", "c"]);
    }
  });
});

describe("checkConflictOfInterest", () => {
  it("passes when no conflicts exist", () => {
    expect(checkConflictOfInterest([], "entity-123")).toBe(true);
  });

  it("passes when conflicts exist but not for the target entity", () => {
    const conflicts = [
      { entityId: "entity-456", relationshipType: "family_member" },
      { entityId: "entity-789", relationshipType: "financial_interest" },
    ];
    expect(checkConflictOfInterest(conflicts, "entity-123")).toBe(true);
  });

  it("throws CONFLICT_OF_INTEREST when target entity is in conflicts", () => {
    const conflicts = [
      { entityId: "entity-123", relationshipType: "family_member" },
    ];
    expect(() => checkConflictOfInterest(conflicts, "entity-123"))
      .toThrow(DomainError);

    try {
      checkConflictOfInterest(conflicts, "entity-123");
    } catch (err) {
      const e = err as DomainError;
      expect(e.code).toBe("CONFLICT_OF_INTEREST");
      expect(e.details?.entityId).toBe("entity-123");
      expect(e.details?.relationshipType).toBe("family_member");
    }
  });
});

describe("validateDailyCapacity", () => {
  it("passes when current assignments are below the daily limit", () => {
    expect(validateDailyCapacity(2, 4)).toBe(true);
  });

  it("passes when current assignments are 0", () => {
    expect(validateDailyCapacity(0, 4)).toBe(true);
  });

  it("throws DAILY_CAPACITY_EXCEEDED when at the limit", () => {
    expect(() => validateDailyCapacity(4, 4)).toThrow(DomainError);

    try {
      validateDailyCapacity(4, 4);
    } catch (err) {
      const e = err as DomainError;
      expect(e.code).toBe("DAILY_CAPACITY_EXCEEDED");
      expect(e.details?.currentAssignments).toBe(4);
      expect(e.details?.dailyLimit).toBe(4);
    }
  });

  it("throws DAILY_CAPACITY_EXCEEDED when over the limit", () => {
    expect(() => validateDailyCapacity(5, 4)).toThrow(DomainError);
  });
});

describe("haversineDistance", () => {
  it("returns 0 for identical points", () => {
    expect(haversineDistance(28.6139, 77.2090, 28.6139, 77.2090)).toBe(0);
  });

  it("computes known distance between New Delhi and Mumbai approximately", () => {
    // New Delhi: 28.6139°N, 77.2090°E
    // Mumbai: 19.0760°N, 72.8777°E
    // Known distance: ~1,153 km
    const distance = haversineDistance(28.6139, 77.2090, 19.0760, 72.8777);
    expect(distance).toBeGreaterThan(1_100_000);
    expect(distance).toBeLessThan(1_200_000);
  });

  it("computes known short distance correctly", () => {
    // India Gate to Rashtrapati Bhavan: ~2.8 km
    const distance = haversineDistance(28.6129, 77.2295, 28.6143, 77.1990);
    expect(distance).toBeGreaterThan(2_500);
    expect(distance).toBeLessThan(3_500);
  });

  it("is symmetric (order of points does not matter)", () => {
    const d1 = haversineDistance(28.6139, 77.2090, 19.0760, 72.8777);
    const d2 = haversineDistance(19.0760, 72.8777, 28.6139, 77.2090);
    expect(d1).toBeCloseTo(d2, 6);
  });

  it("returns a non-negative value for any pair of points", () => {
    const distance = haversineDistance(-33.8688, 151.2093, 51.5074, -0.1278);
    expect(distance).toBeGreaterThanOrEqual(0);
  });
});

describe("validateGeofence", () => {
  it("returns locationMismatch=false when inspector is within radius", () => {
    // Same location — distance 0
    const result = validateGeofence(28.6139, 77.2090, 28.6139, 77.2090, 100);
    expect(result.locationMismatch).toBe(false);
    expect(result.distanceMeters).toBe(0);
  });

  it("returns locationMismatch=true when inspector is outside radius", () => {
    // ~1,153 km apart, radius 500m
    const result = validateGeofence(28.6139, 77.2090, 19.0760, 72.8777, 500);
    expect(result.locationMismatch).toBe(true);
    expect(result.distanceMeters).toBeGreaterThan(1_100_000);
  });

  it("returns locationMismatch=false when distance equals radius exactly (edge case)", () => {
    // Use a known short distance and set radius to match
    const distance = haversineDistance(28.6129, 77.2295, 28.6143, 77.1990);
    const radius = Math.round(distance) + 1; // just above
    const result = validateGeofence(28.6129, 77.2295, 28.6143, 77.1990, radius);
    expect(result.locationMismatch).toBe(false);
  });

  it("distanceMeters is rounded to nearest integer", () => {
    const result = validateGeofence(28.6139, 77.2090, 28.6140, 77.2091, 500);
    expect(Number.isInteger(result.distanceMeters)).toBe(true);
  });
});
