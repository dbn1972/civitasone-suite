import { describe, it, expect } from "vitest";
import { normalizeClosureType, CLOSURE_TYPES } from "./types";

describe("normalizeClosureType (GAP-WORKS-CLOSURE-03)", () => {
  it("passes through the canonical closure types", () => {
    for (const t of CLOSURE_TYPES) {
      expect(normalizeClosureType(t)).toBe(t);
    }
  });

  it("lower-cases and trims before matching", () => {
    expect(normalizeClosureType("  Closed ")).toBe("closed");
    expect(normalizeClosureType("DROPPED")).toBe("dropped");
  });

  it("folds any unknown / missing value to 'other' (never silently 'closed')", () => {
    expect(normalizeClosureType("suspended")).toBe("other");
    expect(normalizeClosureType("")).toBe("other");
    expect(normalizeClosureType(null)).toBe("other");
    expect(normalizeClosureType(undefined)).toBe("other");
    expect(normalizeClosureType(42)).toBe("other");
  });
});
