/**
 * Unit tests for universe module domain logic.
 * Pure functions — no mocks, no I/O, no DB.
 *
 * Validates: Requirements 2.1, 2.2, 2.7, 2.8
 */
import { describe, it, expect } from "vitest";
import {
  VALID_ENTITY_TYPES,
  validateEntityType,
  incrementVersion,
  buildSearchVector,
  serializeEntity,
  deserializeEntity,
} from "../src/modules/universe/domain.js";
import type { RegulatedEntityRow } from "../src/modules/universe/schema.js";

// ── validateEntityType ────────────────────────────────────────────────────────

describe("validateEntityType", () => {
  it("accepts all standard entity types", () => {
    for (const type of VALID_ENTITY_TYPES) {
      expect(() => validateEntityType(type)).not.toThrow();
    }
  });

  it("accepts custom entity types (non-empty strings)", () => {
    expect(() => validateEntityType("custom_pharmacy")).not.toThrow();
    expect(() => validateEntityType("hospital")).not.toThrow();
  });

  it("throws 422 for empty string", () => {
    expect(() => validateEntityType("")).toThrow();
  });

  it("throws 422 for whitespace-only string", () => {
    expect(() => validateEntityType("   ")).toThrow();
  });
});

// ── incrementVersion ──────────────────────────────────────────────────────────

describe("incrementVersion", () => {
  it("returns currentVersion + 1", () => {
    expect(incrementVersion(1)).toBe(2);
    expect(incrementVersion(0)).toBe(1);
    expect(incrementVersion(99)).toBe(100);
  });

  it("throws for negative version", () => {
    expect(() => incrementVersion(-1)).toThrow();
  });

  it("throws for non-integer version", () => {
    expect(() => incrementVersion(1.5)).toThrow();
    expect(() => incrementVersion(NaN)).toThrow();
  });
});

// ── buildSearchVector ─────────────────────────────────────────────────────────

describe("buildSearchVector", () => {
  it("concatenates name, registration number, and address", () => {
    const result = buildSearchVector("Acme Corp", "REG-001", "123 Main St");
    expect(result).toBe("Acme Corp REG-001 123 Main St");
  });

  it("filters out empty/falsy fields", () => {
    const result = buildSearchVector("Acme Corp", "", "123 Main St");
    expect(result).toBe("Acme Corp 123 Main St");
  });

  it("returns empty string when all fields are empty", () => {
    const result = buildSearchVector("", "", "");
    expect(result).toBe("");
  });
});

// ── serializeEntity / deserializeEntity ───────────────────────────────────────

describe("serializeEntity / deserializeEntity round-trip", () => {
  const entity: RegulatedEntityRow = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    tenantId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    registrationNo: "REG-2024-001",
    entityType: "premises",
    name: "Acme Manufacturing",
    jurisdiction: "Delhi",
    addressLine1: "123 Industrial Area",
    addressLine2: "Block B",
    city: "New Delhi",
    state: "Delhi",
    pincode: "110001",
    latitude: "28.6139391",
    longitude: "77.2090212",
    riskCategory: "high",
    metadata: { sector: "chemical" },
    deletedAt: null,
    createdAt: new Date("2024-01-15T10:30:00.000Z"),
    updatedAt: new Date("2024-06-20T14:45:00.000Z"),
    createdBy: "user-001",
    updatedBy: "user-002",
    version: 3,
  };

  it("serializes to JSON-safe object with ISO date strings", () => {
    const serialized = serializeEntity(entity);
    expect(serialized.createdAt).toBe("2024-01-15T10:30:00.000Z");
    expect(serialized.updatedAt).toBe("2024-06-20T14:45:00.000Z");
    expect(serialized.deletedAt).toBeNull();
    expect(serialized.version).toBe(3);
  });

  it("round-trips without data loss", () => {
    const serialized = serializeEntity(entity);
    const deserialized = deserializeEntity(serialized);

    expect(deserialized.id).toBe(entity.id);
    expect(deserialized.tenantId).toBe(entity.tenantId);
    expect(deserialized.registrationNo).toBe(entity.registrationNo);
    expect(deserialized.entityType).toBe(entity.entityType);
    expect(deserialized.name).toBe(entity.name);
    expect(deserialized.jurisdiction).toBe(entity.jurisdiction);
    expect(deserialized.addressLine1).toBe(entity.addressLine1);
    expect(deserialized.addressLine2).toBe(entity.addressLine2);
    expect(deserialized.city).toBe(entity.city);
    expect(deserialized.state).toBe(entity.state);
    expect(deserialized.pincode).toBe(entity.pincode);
    expect(deserialized.latitude).toBe(entity.latitude);
    expect(deserialized.longitude).toBe(entity.longitude);
    expect(deserialized.riskCategory).toBe(entity.riskCategory);
    expect(deserialized.metadata).toEqual(entity.metadata);
    expect(deserialized.deletedAt).toBe(entity.deletedAt);
    expect(deserialized.createdAt.toISOString()).toBe(entity.createdAt.toISOString());
    expect(deserialized.updatedAt.toISOString()).toBe(entity.updatedAt.toISOString());
    expect(deserialized.createdBy).toBe(entity.createdBy);
    expect(deserialized.updatedBy).toBe(entity.updatedBy);
    expect(deserialized.version).toBe(entity.version);
  });

  it("handles null optional fields correctly", () => {
    const entityNoOptionals: RegulatedEntityRow = {
      ...entity,
      addressLine2: null,
      latitude: null,
      longitude: null,
      metadata: null,
    };
    const serialized = serializeEntity(entityNoOptionals);
    expect(serialized.addressLine2).toBeNull();
    expect(serialized.latitude).toBeNull();
    expect(serialized.longitude).toBeNull();
    expect(serialized.metadata).toBeNull();

    const deserialized = deserializeEntity(serialized);
    expect(deserialized.addressLine2).toBeNull();
    expect(deserialized.latitude).toBeNull();
    expect(deserialized.longitude).toBeNull();
    expect(deserialized.metadata).toBeNull();
  });

  it("handles deletedAt Date correctly", () => {
    const deletedEntity: RegulatedEntityRow = {
      ...entity,
      deletedAt: new Date("2024-12-01T00:00:00.000Z"),
    };
    const serialized = serializeEntity(deletedEntity);
    expect(serialized.deletedAt).toBe("2024-12-01T00:00:00.000Z");

    const deserialized = deserializeEntity(serialized);
    expect(deserialized.deletedAt).toEqual(new Date("2024-12-01T00:00:00.000Z"));
  });
});
