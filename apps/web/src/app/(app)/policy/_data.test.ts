import { describe, it, expect } from "vitest";
import { formatAbacPredicate, type AbacPredicate } from "./_data";

// GAP-POLICY-ABAC-01: predicates must render as a human phrase so an admin can
// see what a deny rule matches (they used to be typed `unknown[]` and never
// shown at all).
describe("formatAbacPredicate", () => {
  it("formats equals / not-equals", () => {
    expect(formatAbacPredicate({ op: "equals", path: "resource.dept", value: "IT" })).toBe('resource.dept = "IT"');
    expect(formatAbacPredicate({ op: "not-equals", path: "resource.dept", value: "HR" })).toBe('resource.dept ≠ "HR"');
  });

  it("formats in / not-in with a value list", () => {
    expect(formatAbacPredicate({ op: "in", path: "x", values: ["a", "b"] })).toBe('x in ["a", "b"]');
    expect(formatAbacPredicate({ op: "not-in", path: "x", values: [1] })).toBe("x not in [1]");
  });

  it("formats exists / not-exists / owner-match / tenant-match", () => {
    expect(formatAbacPredicate({ op: "exists", path: "x" })).toBe("x is present");
    expect(formatAbacPredicate({ op: "not-exists", path: "x" })).toBe("x is absent");
    expect(formatAbacPredicate({ op: "owner-match" })).toContain("owner matches");
    expect(formatAbacPredicate({ op: "tenant-match" })).toContain("same tenant");
  });

  it("formats nested or / not", () => {
    const p: AbacPredicate = {
      op: "or",
      predicates: [
        { op: "equals", path: "a", value: 1 },
        { op: "not", predicate: { op: "exists", path: "b" } },
      ],
    };
    expect(formatAbacPredicate(p)).toBe("any of: a = 1 OR not (b is present)");
  });
});
