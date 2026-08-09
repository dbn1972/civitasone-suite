/**
 * Location Service — Domain: Deep tests.
 *
 * Tests coordinate validation, hierarchy cycle detection, LGD code validation.
 * Source: modules/locations/domain.ts
 */
import { describe, it, expect } from "vitest";
import { isValidLatitude, isValidLongitude, isValidCoordinate, wouldCreateCycle, isValidLgdCode, type HierarchyEdge } from "../src/modules/locations/domain.js";

describe("isValidLatitude", () => {
  it("accepts -90 to 90", () => { expect(isValidLatitude(0)).toBe(true); expect(isValidLatitude(-90)).toBe(true); expect(isValidLatitude(90)).toBe(true); });
  it("rejects < -90 or > 90", () => { expect(isValidLatitude(-91)).toBe(false); expect(isValidLatitude(91)).toBe(false); });
});

describe("isValidLongitude", () => {
  it("accepts -180 to 180", () => { expect(isValidLongitude(0)).toBe(true); expect(isValidLongitude(-180)).toBe(true); expect(isValidLongitude(180)).toBe(true); });
  it("rejects outside range", () => { expect(isValidLongitude(-181)).toBe(false); expect(isValidLongitude(181)).toBe(false); });
});

describe("isValidCoordinate", () => {
  it("true when both valid", () => expect(isValidCoordinate(28.6, 77.2)).toBe(true));
  it("false when lat invalid", () => expect(isValidCoordinate(91, 77)).toBe(false));
  it("false when lng invalid", () => expect(isValidCoordinate(28, 181)).toBe(false));
});

describe("wouldCreateCycle — hierarchy cycle prevention", () => {
  const edges: HierarchyEdge[] = [
    { id: "A", parentId: null }, { id: "B", parentId: "A" }, { id: "C", parentId: "B" },
  ];
  it("no cycle for top-level (null parent)", () => expect(wouldCreateCycle(edges, "A", null)).toBe(false));
  it("self-parenting is a cycle", () => expect(wouldCreateCycle(edges, "A", "A")).toBe(true));
  it("no cycle for valid child→parent", () => expect(wouldCreateCycle(edges, "D", "C")).toBe(false));
  it("cycle: making A child of C (C→B→A, so A is ancestor of C)", () => expect(wouldCreateCycle(edges, "A", "C")).toBe(true));
  it("cycle: making B child of C (C→B, so B is ancestor of C)", () => expect(wouldCreateCycle(edges, "B", "C")).toBe(true));
  it("no cycle for unrelated node", () => expect(wouldCreateCycle(edges, "X", "C")).toBe(false));
});

describe("isValidLgdCode", () => {
  it("accepts digits only", () => expect(isValidLgdCode("123456")).toBe(true));
  it("rejects letters", () => expect(isValidLgdCode("12AB")).toBe(false));
  it("rejects empty", () => expect(isValidLgdCode("")).toBe(false));
  it("rejects > 32 chars", () => expect(isValidLgdCode("1".repeat(33))).toBe(false));
  it("accepts 1-digit code", () => expect(isValidLgdCode("7")).toBe(true));
});
