/**
 * CRM Accounts — hierarchy cycle detection and ancestor chain tests.
 * Pack #01. Source: modules/accounts/hierarchy-domain.ts
 */
import { describe, it, expect } from "vitest";
import { wouldCreateCycle, buildAncestorChain, type AccountNode } from "../src/modules/accounts/hierarchy-domain.js";

function buildMap(nodes: AccountNode[]): Map<string, AccountNode> {
  return new Map(nodes.map(n => [n.id, n]));
}

describe("wouldCreateCycle", () => {
  it("self-assignment creates a cycle", () => {
    const map = buildMap([{ id: "A", parentId: null }]);
    expect(wouldCreateCycle("A", "A", map)).toBe(true);
  });

  it("simple parent-child cycle: making A's parent → B when B's parent is A", () => {
    // Currently: B.parent = A (B is child of A). Proposing A.parent = B → cycle
    const map = buildMap([{ id: "A", parentId: null }, { id: "B", parentId: "A" }]);
    expect(wouldCreateCycle("A", "B", map)).toBe(true);
  });

  it("no cycle for unrelated nodes", () => {
    const map = buildMap([{ id: "A", parentId: null }, { id: "B", parentId: null }, { id: "C", parentId: null }]);
    expect(wouldCreateCycle("A", "B", map)).toBe(false);
  });

  it("deep chain: no cycle when attaching to a sibling branch", () => {
    // A → B → C → D (linear), proposing D.parent = E (separate)
    const map = buildMap([
      { id: "A", parentId: "B" }, { id: "B", parentId: "C" },
      { id: "C", parentId: "D" }, { id: "D", parentId: null },
      { id: "E", parentId: null },
    ]);
    expect(wouldCreateCycle("A", "E", map)).toBe(false);
  });

  it("detects cycle in 3-node chain: C→B→A, proposing A.parent = C", () => {
    // Currently: C.parent = B, B.parent = A, A = root. Proposing A.parent = C → cycle
    const map = buildMap([{ id: "A", parentId: null }, { id: "B", parentId: "A" }, { id: "C", parentId: "B" }]);
    expect(wouldCreateCycle("A", "C", map)).toBe(true);
  });

  it("handles missing nodes gracefully (stops traversal)", () => {
    const map = buildMap([{ id: "A", parentId: "MISSING" }]);
    expect(wouldCreateCycle("X", "A", map)).toBe(false);
  });
});

describe("buildAncestorChain", () => {
  it("returns empty for root node (no parent)", () => {
    const map = buildMap([{ id: "A", parentId: null }]);
    expect(buildAncestorChain("A", map)).toEqual([]);
  });

  it("returns [parent] for depth-1", () => {
    const map = buildMap([{ id: "A", parentId: "B" }, { id: "B", parentId: null }]);
    expect(buildAncestorChain("A", map)).toEqual(["B"]);
  });

  it("returns full chain: parent → grandparent → root", () => {
    const map = buildMap([
      { id: "A", parentId: "B" }, { id: "B", parentId: "C" }, { id: "C", parentId: null },
    ]);
    expect(buildAncestorChain("A", map)).toEqual(["B", "C"]);
  });

  it("respects maxDepth (stops early)", () => {
    const map = buildMap([
      { id: "A", parentId: "B" }, { id: "B", parentId: "C" },
      { id: "C", parentId: "D" }, { id: "D", parentId: null },
    ]);
    expect(buildAncestorChain("A", map, 2)).toEqual(["B", "C"]);
  });

  it("breaks on cycle (does not loop forever)", () => {
    const map = buildMap([{ id: "A", parentId: "B" }, { id: "B", parentId: "A" }]);
    const chain = buildAncestorChain("A", map);
    expect(chain.length).toBeLessThanOrEqual(50);
  });
});
