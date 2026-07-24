/**
 * Property-based tests for universe module domain logic.
 * Uses fast-check to verify universal correctness properties hold across
 * all valid inputs — not just hand-picked examples.
 *
 * **Validates: Requirements 2.1, 2.2, 2.4, 2.5, 2.7, 2.8**
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  VALID_ENTITY_TYPES,
  validateEntityType,
  incrementVersion,
  buildSearchVector,
  serializeEntity,
  deserializeEntity,
} from "../src/modules/universe/domain.js";
import type { RegulatedEntityRow } from "../src/modules/universe/schema.js";

// ── Generators ────────────────────────────────────────────────────────────────

/** Generate a valid UUID v4 string. */
const arbUuid = fc.uuid();

/** Generate a valid entity type (standard or custom non-empty string). */
const arbEntityType = fc.oneof(
  fc.constantFrom(...VALID_ENTITY_TYPES),
  fc.string({ minLength: 1, maxLength: 48 }).filter((s) => s.trim().length > 0),
);

/** Generate a valid pincode (1–10 chars). */
const arbPincode = fc.stringOf(fc.constantFrom("0", "1", "2", "3", "4", "5", "6", "7", "8", "9"), {
  minLength: 1,
  maxLength: 10,
});

/** Generate a risk category. */
const arbRiskCategory = fc.constantFrom("low", "medium", "high", "critical");

/** Generate a latitude string (valid range). */
const arbLatitude = fc.option(
  fc.double({ min: -90, max: 90, noNaN: true, noDefaultInfinity: true })
    .map((v) => v.toFixed(7)),
  { nil: null },
);

/** Generate a longitude string (valid range). */
const arbLongitude = fc.option(
  fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true })
    .map((v) => v.toFixed(7)),
  { nil: null },
);

/** Generate a valid Date within a reasonable range. */
const arbDate = fc.date({
  min: new Date("2020-01-01T00:00:00.000Z"),
  max: new Date("2030-12-31T23:59:59.999Z"),
});

/** Generate a simple JSON-safe metadata object or null. */
const arbMetadata = fc.option(
  fc.dictionary(
    fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
    fc.oneof(fc.string(), fc.integer(), fc.boolean()),
    { minKeys: 0, maxKeys: 5 },
  ),
  { nil: null },
);

/** Generate a complete RegulatedEntityRow (in-memory representation). */
const arbRegulatedEntity: fc.Arbitrary<RegulatedEntityRow> = fc.record({
  id: arbUuid,
  tenantId: arbUuid,
  registrationNo: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  entityType: arbEntityType,
  name: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  jurisdiction: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  addressLine1: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
  addressLine2: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: null }),
  city: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  state: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  pincode: arbPincode,
  latitude: arbLatitude,
  longitude: arbLongitude,
  riskCategory: arbRiskCategory,
  metadata: arbMetadata,
  deletedAt: fc.option(arbDate, { nil: null }),
  createdAt: arbDate,
  updatedAt: arbDate,
  createdBy: arbUuid,
  updatedBy: arbUuid,
  version: fc.nat({ max: 10000 }),
});

// ── Property 2: Master Data Round-Trip ────────────────────────────────────────

describe("Property 2: Master Data Round-Trip", () => {
  /**
   * **Validates: Requirements 2.1, 2.4, 2.5**
   *
   * For any valid regulated entity record, creating the record (constructing
   * the in-memory row) and reading it back (via serialize→deserialize) should
   * preserve all fields without data loss (structural equality).
   */
  it("creating an entity and reading it back preserves all fields", () => {
    fc.assert(
      fc.property(arbRegulatedEntity, (entity) => {
        // Simulate the "create → read back" by serializing to JSON (as the DB/cache would)
        // and deserializing back — this is how the system stores and retrieves entities.
        const serialized = serializeEntity(entity);
        const readBack = deserializeEntity(serialized);

        // Structural equality: all scalar fields match
        expect(readBack.id).toBe(entity.id);
        expect(readBack.tenantId).toBe(entity.tenantId);
        expect(readBack.registrationNo).toBe(entity.registrationNo);
        expect(readBack.entityType).toBe(entity.entityType);
        expect(readBack.name).toBe(entity.name);
        expect(readBack.jurisdiction).toBe(entity.jurisdiction);
        expect(readBack.addressLine1).toBe(entity.addressLine1);
        expect(readBack.addressLine2).toBe(entity.addressLine2);
        expect(readBack.city).toBe(entity.city);
        expect(readBack.state).toBe(entity.state);
        expect(readBack.pincode).toBe(entity.pincode);
        expect(readBack.latitude).toBe(entity.latitude);
        expect(readBack.longitude).toBe(entity.longitude);
        expect(readBack.riskCategory).toBe(entity.riskCategory);
        expect(readBack.metadata).toEqual(entity.metadata);
        expect(readBack.createdBy).toBe(entity.createdBy);
        expect(readBack.updatedBy).toBe(entity.updatedBy);
        expect(readBack.version).toBe(entity.version);

        // Date fields: compare as ISO strings (Date objects lose ms precision in
        // some serialization paths, but ISO round-trip is exact)
        expect(readBack.createdAt.toISOString()).toBe(entity.createdAt.toISOString());
        expect(readBack.updatedAt.toISOString()).toBe(entity.updatedAt.toISOString());
        if (entity.deletedAt) {
          expect(readBack.deletedAt!.toISOString()).toBe(entity.deletedAt.toISOString());
        } else {
          expect(readBack.deletedAt).toBeNull();
        }
      }),
      { numRuns: 200 },
    );
  });
});

// ── Property 3: Entity Version Increment ──────────────────────────────────────

describe("Property 3: Entity Version Increment", () => {
  /**
   * **Validates: Requirements 2.2**
   *
   * For any regulated entity and valid update, the version after a successful
   * update equals the version before the update plus 1.
   */
  it("incrementVersion always returns previous + 1 for valid inputs", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 1_000_000 }),
        (currentVersion) => {
          const result = incrementVersion(currentVersion);
          expect(result).toBe(currentVersion + 1);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("incrementVersion rejects negative versions", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: -1 }),
        (negativeVersion) => {
          expect(() => incrementVersion(negativeVersion)).toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("incrementVersion rejects non-integer versions", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 1_000_000, noNaN: true, noDefaultInfinity: true })
          .filter((v) => !Number.isInteger(v)),
        (nonIntegerVersion) => {
          expect(() => incrementVersion(nonIntegerVersion)).toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Property 4: Entity JSON Serialization Round-Trip ──────────────────────────

describe("Property 4: Entity JSON Serialization Round-Trip", () => {
  /**
   * **Validates: Requirements 2.8**
   *
   * For any valid regulated entity record, serializing to JSON and deserializing
   * back produces a structurally equivalent entity (no field loss, no type
   * coercion errors).
   */
  it("serialize → JSON.stringify → JSON.parse → deserialize preserves all fields", () => {
    fc.assert(
      fc.property(arbRegulatedEntity, (entity) => {
        // Full round-trip: entity → SerializedEntity → JSON string → parsed → deserialize
        const serialized = serializeEntity(entity);
        const jsonString = JSON.stringify(serialized);
        const parsed = JSON.parse(jsonString);
        const restored = deserializeEntity(parsed);

        // All string fields preserved exactly
        expect(restored.id).toBe(entity.id);
        expect(restored.tenantId).toBe(entity.tenantId);
        expect(restored.registrationNo).toBe(entity.registrationNo);
        expect(restored.entityType).toBe(entity.entityType);
        expect(restored.name).toBe(entity.name);
        expect(restored.jurisdiction).toBe(entity.jurisdiction);
        expect(restored.addressLine1).toBe(entity.addressLine1);
        expect(restored.addressLine2).toBe(entity.addressLine2);
        expect(restored.city).toBe(entity.city);
        expect(restored.state).toBe(entity.state);
        expect(restored.pincode).toBe(entity.pincode);
        expect(restored.latitude).toBe(entity.latitude);
        expect(restored.longitude).toBe(entity.longitude);
        expect(restored.riskCategory).toBe(entity.riskCategory);
        expect(restored.createdBy).toBe(entity.createdBy);
        expect(restored.updatedBy).toBe(entity.updatedBy);

        // Numeric field preserved
        expect(restored.version).toBe(entity.version);

        // Metadata (JSONB) deep equality
        expect(restored.metadata).toEqual(entity.metadata);

        // Date fields survive the full JSON round-trip
        expect(restored.createdAt.toISOString()).toBe(entity.createdAt.toISOString());
        expect(restored.updatedAt.toISOString()).toBe(entity.updatedAt.toISOString());
        if (entity.deletedAt) {
          expect(restored.deletedAt!.toISOString()).toBe(entity.deletedAt.toISOString());
        } else {
          expect(restored.deletedAt).toBeNull();
        }
      }),
      { numRuns: 200 },
    );
  });

  it("serialized output contains all required fields (no undefined values)", () => {
    fc.assert(
      fc.property(arbRegulatedEntity, (entity) => {
        const serialized = serializeEntity(entity);

        // All mandatory fields are present and not undefined
        const requiredKeys: (keyof typeof serialized)[] = [
          "id", "tenantId", "registrationNo", "entityType", "name",
          "jurisdiction", "addressLine1", "city", "state", "pincode",
          "riskCategory", "createdAt", "updatedAt", "createdBy", "updatedBy", "version",
        ];
        for (const key of requiredKeys) {
          expect(serialized[key]).not.toBeUndefined();
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 5: Full-Text Search Correctness ──────────────────────────────────

describe("Property 5: Full-Text Search Correctness", () => {
  /**
   * **Validates: Requirements 2.7**
   *
   * For any search query matching a known entity's name, registration number,
   * or address, the search vector built from that entity must contain the
   * search term. This validates the pure domain logic that backs the full-text
   * search — `buildSearchVector` correctly includes all searchable fields.
   */
  it("buildSearchVector includes name, registrationNo, and address for any entity", () => {
    fc.assert(
      fc.property(arbRegulatedEntity, (entity) => {
        const searchVector = buildSearchVector(
          entity.name,
          entity.registrationNo,
          entity.addressLine1,
        );

        // The search vector must contain the entity's name
        expect(searchVector).toContain(entity.name);
        // The search vector must contain the registration number
        expect(searchVector).toContain(entity.registrationNo);
        // The search vector must contain the address
        expect(searchVector).toContain(entity.addressLine1);
      }),
      { numRuns: 200 },
    );
  });

  it("searching by any word in name/regNo/address finds it in the search vector", () => {
    fc.assert(
      fc.property(
        // Generate an entity name and pick a word from it to search
        fc.tuple(
          fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
          fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
          fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
        ),
        ([name, regNo, address]) => {
          const searchVector = buildSearchVector(name, regNo, address);

          // Search for any of the three fields — each must appear in the result
          expect(searchVector.includes(name)).toBe(true);
          expect(searchVector.includes(regNo)).toBe(true);
          expect(searchVector.includes(address)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("search vector is empty only when all input fields are empty/falsy", () => {
    fc.assert(
      fc.property(
        fc.tuple(fc.string(), fc.string(), fc.string()),
        ([name, regNo, address]) => {
          const searchVector = buildSearchVector(name, regNo, address);
          const allEmpty = !name && !regNo && !address;

          if (allEmpty) {
            expect(searchVector).toBe("");
          } else {
            expect(searchVector.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
