/**
 * Property-based tests for assignment domain logic.
 *
 * **Property 11: Competency Validation** — passes iff required ⊆ inspector competencies
 * **Property 12: Conflict of Interest Detection** — rejects iff entityId in conflicts
 * **Property 13: Geofence Validation** — locationMismatch iff haversine > radius
 * **Property 14: Inspector Daily Capacity** — passes iff currentAssignments < dailyLimit
 *
 * Pure functions — no mocks, no I/O, no DB.
 *
 * **Validates: Requirements 4.1, 4.2, 4.5, 4.8**
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  validateCompetency,
  checkConflictOfInterest,
  validateDailyCapacity,
  haversineDistance,
  validateGeofence,
  DomainError,
  type ConflictDeclaration,
} from "../src/modules/assignment/domain.js";

// ── Property 11: Competency Validation ────────────────────────────────────────

describe("Property 11: Competency Validation", () => {
  /**
   * **Validates: Requirements 4.1**
   *
   * For any inspector competency set that is a superset of (or equal to) the
   * required competency set, validateCompetency must accept (return true).
   */
  it("passes when required ⊆ inspector competencies", () => {
    fc.assert(
      fc.property(
        // Generate a pool of competencies, then split into required (subset) and inspector (superset)
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 10 }).chain(
          (pool) => {
            const unique = [...new Set(pool)];
            if (unique.length === 0) return fc.constant({ inspector: ["a"], required: ["a"] });
            return fc.tuple(
              // Inspector has all unique competencies (superset)
              fc.constant(unique),
              // Required is a non-empty subset of unique
              fc.subarray(unique, { minLength: 1, maxLength: unique.length }),
            ).map(([inspector, required]) => ({ inspector, required }));
          },
        ),
        ({ inspector, required }) => {
          expect(validateCompetency(inspector, required)).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 4.1**
   *
   * For any inspector competency set and required set where at least one
   * required competency is NOT in the inspector's set, validateCompetency
   * must reject (throw DomainError with INSUFFICIENT_COMPETENCY).
   */
  it("rejects when required ⊄ inspector competencies", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 0, maxLength: 8 }),
        // Generate at least one competency that is NOT in the inspector set
        fc.string({ minLength: 1, maxLength: 20 }),
        (inspectorCompetencies, extraRequired) => {
          // Ensure extraRequired is truly not in the inspector's set
          const inspectorSet = new Set(inspectorCompetencies);
          fc.pre(!inspectorSet.has(extraRequired));

          const required = [...inspectorCompetencies.slice(0, 2), extraRequired];

          expect(() => validateCompetency(inspectorCompetencies, required)).toThrow(DomainError);
          try {
            validateCompetency(inspectorCompetencies, required);
          } catch (e) {
            expect((e as DomainError).code).toBe("INSUFFICIENT_COMPETENCY");
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 4.1**
   *
   * Biconditional: validateCompetency passes iff required ⊆ inspector.
   */
  it("passes iff required ⊆ inspector (biconditional)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-z]{1,8}$/), { minLength: 0, maxLength: 8 }),
        fc.array(fc.stringMatching(/^[a-z]{1,8}$/), { minLength: 0, maxLength: 8 }),
        (inspectorCompetencies, requiredCompetencies) => {
          const inspectorSet = new Set(inspectorCompetencies);
          const isSubset = requiredCompetencies.every((c) => inspectorSet.has(c));

          if (isSubset) {
            expect(validateCompetency(inspectorCompetencies, requiredCompetencies)).toBe(true);
          } else {
            expect(() => validateCompetency(inspectorCompetencies, requiredCompetencies)).toThrow(
              DomainError,
            );
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});

// ── Property 12: Conflict of Interest Detection ───────────────────────────────

describe("Property 12: Conflict of Interest Detection", () => {
  /** Arbitrary for a conflict declaration. */
  const conflictArb: fc.Arbitrary<ConflictDeclaration> = fc.record({
    entityId: fc.uuid(),
    relationshipType: fc.constantFrom("family", "financial", "personal", "business"),
  });

  /**
   * **Validates: Requirements 4.2**
   *
   * For any set of conflict declarations and a target entity that is NOT
   * in the conflicts list, checkConflictOfInterest must accept (return true).
   */
  it("passes when targetEntityId is not in conflicts", () => {
    fc.assert(
      fc.property(
        fc.array(conflictArb, { minLength: 0, maxLength: 10 }),
        fc.uuid(),
        (conflicts, targetEntityId) => {
          // Ensure the target is not in the conflicts
          fc.pre(!conflicts.some((c) => c.entityId === targetEntityId));

          expect(checkConflictOfInterest(conflicts, targetEntityId)).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 4.2**
   *
   * For any set of conflict declarations, if the target entity IS in the
   * conflicts list, checkConflictOfInterest must reject (throw DomainError).
   */
  it("rejects when targetEntityId is in conflicts", () => {
    fc.assert(
      fc.property(
        fc.array(conflictArb, { minLength: 0, maxLength: 9 }),
        conflictArb,
        (otherConflicts, matchingConflict) => {
          const conflicts = [...otherConflicts, matchingConflict];
          const targetEntityId = matchingConflict.entityId;

          expect(() => checkConflictOfInterest(conflicts, targetEntityId)).toThrow(DomainError);
          try {
            checkConflictOfInterest(conflicts, targetEntityId);
          } catch (e) {
            expect((e as DomainError).code).toBe("CONFLICT_OF_INTEREST");
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 4.2**
   *
   * Biconditional: checkConflictOfInterest rejects iff entityId in conflicts.
   */
  it("rejects iff targetEntityId is in conflicts (biconditional)", () => {
    fc.assert(
      fc.property(
        fc.array(conflictArb, { minLength: 0, maxLength: 10 }),
        fc.uuid(),
        (conflicts, targetEntityId) => {
          const hasConflict = conflicts.some((c) => c.entityId === targetEntityId);

          if (hasConflict) {
            expect(() => checkConflictOfInterest(conflicts, targetEntityId)).toThrow(DomainError);
          } else {
            expect(checkConflictOfInterest(conflicts, targetEntityId)).toBe(true);
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});

// ── Property 13: Geofence Validation ──────────────────────────────────────────

describe("Property 13: Geofence Validation", () => {
  /** Arbitrary for valid latitude (-90 to 90). */
  const latArb = fc.double({ min: -90, max: 90, noNaN: true, noDefaultInfinity: true });
  /** Arbitrary for valid longitude (-180 to 180). */
  const lonArb = fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true });
  /** Arbitrary for geofence radius in meters. */
  const radiusArb = fc.double({ min: 1, max: 50_000, noNaN: true, noDefaultInfinity: true });

  /**
   * **Validates: Requirements 4.5**
   *
   * For any two GPS positions and a radius, validateGeofence returns
   * locationMismatch = true iff haversineDistance > radius.
   */
  it("locationMismatch iff haversine > radius (biconditional)", () => {
    fc.assert(
      fc.property(
        latArb,
        lonArb,
        latArb,
        lonArb,
        radiusArb,
        (inspectorLat, inspectorLon, entityLat, entityLon, radius) => {
          const distance = haversineDistance(inspectorLat, inspectorLon, entityLat, entityLon);
          const result = validateGeofence(inspectorLat, inspectorLon, entityLat, entityLon, radius);

          expect(result.locationMismatch).toBe(distance > radius);
        },
      ),
      { numRuns: 500 },
    );
  });

  /**
   * **Validates: Requirements 4.5**
   *
   * For identical positions (distance = 0), locationMismatch is always false
   * for any positive radius.
   */
  it("same position always passes geofence (locationMismatch = false)", () => {
    fc.assert(
      fc.property(latArb, lonArb, radiusArb, (lat, lon, radius) => {
        const result = validateGeofence(lat, lon, lat, lon, radius);
        expect(result.locationMismatch).toBe(false);
        expect(result.distanceMeters).toBe(0);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 4.5**
   *
   * haversineDistance is always non-negative.
   */
  it("haversineDistance is non-negative for any valid coordinates", () => {
    fc.assert(
      fc.property(latArb, lonArb, latArb, lonArb, (lat1, lon1, lat2, lon2) => {
        const d = haversineDistance(lat1, lon1, lat2, lon2);
        expect(d).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 4.5**
   *
   * haversineDistance is symmetric: dist(A, B) === dist(B, A).
   */
  it("haversineDistance is symmetric", () => {
    fc.assert(
      fc.property(latArb, lonArb, latArb, lonArb, (lat1, lon1, lat2, lon2) => {
        const d1 = haversineDistance(lat1, lon1, lat2, lon2);
        const d2 = haversineDistance(lat2, lon2, lat1, lon1);
        expect(d1).toBeCloseTo(d2, 6);
      }),
      { numRuns: 300 },
    );
  });
});

// ── Property 14: Inspector Daily Capacity ─────────────────────────────────────

describe("Property 14: Inspector Daily Capacity", () => {
  /**
   * **Validates: Requirements 4.8**
   *
   * For any currentAssignments < dailyLimit, validateDailyCapacity must
   * accept (return true).
   */
  it("passes when currentAssignments < dailyLimit", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        (dailyLimit) => {
          const currentAssignments = fc.sample(
            fc.integer({ min: 0, max: dailyLimit - 1 }),
            1,
          )[0]!;
          expect(validateDailyCapacity(currentAssignments, dailyLimit)).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 4.8**
   *
   * For any currentAssignments >= dailyLimit, validateDailyCapacity must
   * reject (throw DomainError with DAILY_CAPACITY_EXCEEDED).
   */
  it("rejects when currentAssignments >= dailyLimit", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 0, max: 50 }),
        (dailyLimit, excess) => {
          const currentAssignments = dailyLimit + excess; // >= dailyLimit

          expect(() => validateDailyCapacity(currentAssignments, dailyLimit)).toThrow(DomainError);
          try {
            validateDailyCapacity(currentAssignments, dailyLimit);
          } catch (e) {
            expect((e as DomainError).code).toBe("DAILY_CAPACITY_EXCEEDED");
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 4.8**
   *
   * Biconditional: validateDailyCapacity passes iff currentAssignments < dailyLimit.
   */
  it("passes iff currentAssignments < dailyLimit (biconditional)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        (currentAssignments, dailyLimit) => {
          const shouldPass = currentAssignments < dailyLimit;

          if (shouldPass) {
            expect(validateDailyCapacity(currentAssignments, dailyLimit)).toBe(true);
          } else {
            expect(() => validateDailyCapacity(currentAssignments, dailyLimit)).toThrow(
              DomainError,
            );
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});
