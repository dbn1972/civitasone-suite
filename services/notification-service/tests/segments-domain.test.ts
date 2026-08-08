/**
 * Pack #23 — Segments: domain logic for criteria validation and query building.
 */
import { describe, it, expect } from "vitest";
import {
  validateCriteria,
  buildSegmentQuery,
  isSegmentNonEmpty,
  type SegmentCriteria,
} from "../src/modules/segments/domain.js";

describe("validateCriteria", () => {
  it("returns null for valid criteria with roles", () => {
    expect(validateCriteria({ roles: ["admin", "editor"] })).toBeNull();
  });

  it("returns null for valid criteria with departmentIds", () => {
    expect(validateCriteria({ departmentIds: ["dept-1"] })).toBeNull();
  });

  it("returns null for valid criteria with locationIds", () => {
    expect(validateCriteria({ locationIds: ["loc-1"] })).toBeNull();
  });

  it("returns null for valid criteria with custom attributes", () => {
    expect(validateCriteria({ attributes: { tier: "premium" } })).toBeNull();
  });

  it("returns error for null criteria", () => {
    expect(validateCriteria(null)).toBe("criteria must be a non-empty object");
  });

  it("returns error for undefined criteria", () => {
    expect(validateCriteria(undefined)).toBe("criteria must be a non-empty object");
  });

  it("returns error for non-object criteria", () => {
    expect(validateCriteria("string")).toBe("criteria must be a non-empty object");
    expect(validateCriteria(42)).toBe("criteria must be a non-empty object");
  });

  it("returns error for empty object — at least one filter required", () => {
    expect(validateCriteria({})).toBe(
      "criteria must contain at least one filter (roles, departmentIds, locationIds, or attributes)",
    );
  });

  it("returns error for empty arrays (no effective filter)", () => {
    expect(validateCriteria({ roles: [] })).toBe(
      "criteria must contain at least one filter (roles, departmentIds, locationIds, or attributes)",
    );
  });

  it("returns error when roles contain empty strings", () => {
    expect(validateCriteria({ roles: ["admin", ""] })).toBe(
      "roles must be an array of non-empty strings",
    );
  });

  it("returns error when departmentIds contain empty strings", () => {
    expect(validateCriteria({ departmentIds: [""] })).toBe(
      "departmentIds must be an array of non-empty strings",
    );
  });

  it("returns error when locationIds contain empty strings", () => {
    expect(validateCriteria({ locationIds: ["loc-1", ""] })).toBe(
      "locationIds must be an array of non-empty strings",
    );
  });

  it("accepts multiple filter types together", () => {
    expect(validateCriteria({
      roles: ["admin"],
      departmentIds: ["dept-1"],
      locationIds: ["loc-1"],
      attributes: { tier: "gold" },
    })).toBeNull();
  });
});

describe("buildSegmentQuery — AND filter construction", () => {
  it("builds role filter with 'in' operator", () => {
    const criteria: SegmentCriteria = { roles: ["admin", "manager"] };
    const filters = buildSegmentQuery(criteria);
    expect(filters).toEqual([
      { field: "role", operator: "in", value: ["admin", "manager"] },
    ]);
  });

  it("builds department filter", () => {
    const criteria: SegmentCriteria = { departmentIds: ["d1", "d2"] };
    const filters = buildSegmentQuery(criteria);
    expect(filters).toEqual([
      { field: "department_id", operator: "in", value: ["d1", "d2"] },
    ]);
  });

  it("builds location filter", () => {
    const criteria: SegmentCriteria = { locationIds: ["l1"] };
    const filters = buildSegmentQuery(criteria);
    expect(filters).toEqual([
      { field: "location_id", operator: "in", value: ["l1"] },
    ]);
  });

  it("builds attribute filter with 'eq' for single value", () => {
    const criteria: SegmentCriteria = { attributes: { tier: "premium" } };
    const filters = buildSegmentQuery(criteria);
    expect(filters).toEqual([
      { field: "attr.tier", operator: "eq", value: "premium" },
    ]);
  });

  it("builds attribute filter with 'in' for array values", () => {
    const criteria: SegmentCriteria = { attributes: { tier: ["gold", "silver"] } };
    const filters = buildSegmentQuery(criteria);
    expect(filters).toEqual([
      { field: "attr.tier", operator: "in", value: ["gold", "silver"] },
    ]);
  });

  it("combines all filters with AND logic (multiple entries)", () => {
    const criteria: SegmentCriteria = {
      roles: ["admin"],
      departmentIds: ["d1"],
      attributes: { grade: "A" },
    };
    const filters = buildSegmentQuery(criteria);
    expect(filters).toHaveLength(3);
    expect(filters.map((f) => f.field)).toEqual(["role", "department_id", "attr.grade"]);
  });

  it("returns empty array for empty criteria", () => {
    const filters = buildSegmentQuery({});
    expect(filters).toEqual([]);
  });
});

describe("isSegmentNonEmpty", () => {
  it("returns true for positive count", () => {
    expect(isSegmentNonEmpty(1)).toBe(true);
    expect(isSegmentNonEmpty(100)).toBe(true);
  });

  it("returns false for zero", () => {
    expect(isSegmentNonEmpty(0)).toBe(false);
  });
});
