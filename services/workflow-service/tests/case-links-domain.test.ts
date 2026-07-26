/** CAP-033 — case relationship pure domain: cycles, split allocation, merge. */
import { describe, it, expect } from "vitest";
import {
  validateLink, wouldCreateCycle, containmentEdge, planSplit, planMerge,
  type CaseLink,
} from "../src/modules/case-links/domain.js";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";

describe("containmentEdge", () => {
  it("maps hierarchical types to ancestor->descendant and skips flat types", () => {
    expect(containmentEdge({ fromCaseId: A, toCaseId: B, type: "parent_child" })).toEqual({ ancestor: A, descendant: B });
    expect(containmentEdge({ fromCaseId: A, toCaseId: B, type: "split_from" })).toEqual({ ancestor: B, descendant: A });
    expect(containmentEdge({ fromCaseId: A, toCaseId: B, type: "merged_from" })).toEqual({ ancestor: A, descendant: B });
    expect(containmentEdge({ fromCaseId: A, toCaseId: B, type: "related" })).toBeNull();
    expect(containmentEdge({ fromCaseId: A, toCaseId: B, type: "duplicate_of" })).toBeNull();
  });
});

describe("wouldCreateCycle", () => {
  it("detects a direct back-edge", () => {
    const links: CaseLink[] = [{ fromCaseId: A, toCaseId: B, type: "parent_child" }];
    expect(wouldCreateCycle(links, B, A)).toBe(true); // B->A closes A->B
  });
  it("detects a transitive cycle A->B->C then C->A", () => {
    const links: CaseLink[] = [
      { fromCaseId: A, toCaseId: B, type: "parent_child" },
      { fromCaseId: B, toCaseId: C, type: "parent_child" },
    ];
    expect(wouldCreateCycle(links, C, A)).toBe(true);
    expect(wouldCreateCycle(links, A, C)).toBe(false); // A already ancestor of C, adding A->C is not a cycle
  });
  it("treats self as a cycle", () => {
    expect(wouldCreateCycle([], A, A)).toBe(true);
  });
  it("ignores non-hierarchical links when computing reachability", () => {
    const links: CaseLink[] = [{ fromCaseId: A, toCaseId: B, type: "related" }];
    expect(wouldCreateCycle(links, B, A)).toBe(false);
  });
});

describe("validateLink", () => {
  it("blocks self links", () => {
    expect(validateLink({ fromCaseId: A, toCaseId: A, type: "related", existing: [] }).errors).toContain("SELF_LINK");
  });
  it("blocks duplicates", () => {
    const existing: CaseLink[] = [{ fromCaseId: A, toCaseId: B, type: "related" }];
    expect(validateLink({ fromCaseId: A, toCaseId: B, type: "related", existing }).errors).toContain("DUPLICATE_LINK");
  });
  it("blocks a parent_child link that would create a cycle", () => {
    const existing: CaseLink[] = [{ fromCaseId: A, toCaseId: B, type: "parent_child" }];
    const r = validateLink({ fromCaseId: B, toCaseId: A, type: "parent_child", existing });
    expect(r.allowed).toBe(false);
    expect(r.errors).toContain("CYCLE_DETECTED");
  });
  it("blocks duplicate-of when the target is itself already a duplicate (chain)", () => {
    const existing: CaseLink[] = [{ fromCaseId: B, toCaseId: C, type: "duplicate_of" }];
    const r = validateLink({ fromCaseId: A, toCaseId: B, type: "duplicate_of", existing });
    expect(r.errors).toContain("DUPLICATE_OF_A_DUPLICATE");
  });
  it("allows a clean related link", () => {
    expect(validateLink({ fromCaseId: A, toCaseId: B, type: "related", existing: [] }).allowed).toBe(true);
  });
});

describe("planSplit — children sum to the parent", () => {
  it("requires at least two children", () => {
    expect(planSplit([{ title: "x", caseType: "t" }]).errors).toContain("SPLIT_NEEDS_TWO_CHILDREN");
  });
  it("accepts allocations that sum to 100", () => {
    const r = planSplit([
      { title: "a", caseType: "t", allocation: 60 },
      { title: "b", caseType: "t", allocation: 40 },
    ]);
    expect(r.allowed).toBe(true);
    expect(r.errors).toEqual([]);
  });
  it("rejects allocations that do not sum to 100", () => {
    const r = planSplit([
      { title: "a", caseType: "t", allocation: 60 },
      { title: "b", caseType: "t", allocation: 30 },
    ]);
    expect(r.errors).toContain("ALLOCATION_SUM_NOT_100");
  });
  it("rejects a partial allocation set", () => {
    const r = planSplit([
      { title: "a", caseType: "t", allocation: 100 },
      { title: "b", caseType: "t" },
    ]);
    expect(r.errors).toContain("PARTIAL_ALLOCATION");
  });
  it("rejects out-of-range allocation", () => {
    const r = planSplit([
      { title: "a", caseType: "t", allocation: 120 },
      { title: "b", caseType: "t", allocation: -20 },
    ]);
    expect(r.errors).toContain("ALLOCATION_OUT_OF_RANGE");
  });
  it("allows a qualitative split with no allocations", () => {
    expect(planSplit([{ title: "a", caseType: "t" }, { title: "b", caseType: "t" }]).allowed).toBe(true);
  });
});

describe("planMerge — consolidates >= 2 distinct sources into a target", () => {
  it("requires two sources", () => {
    expect(planMerge([A], B).errors).toContain("MERGE_NEEDS_TWO_SOURCES");
  });
  it("blocks the target appearing in sources", () => {
    expect(planMerge([A, B], A).errors).toContain("TARGET_IN_SOURCES");
  });
  it("blocks duplicate sources", () => {
    expect(planMerge([A, A], B).errors).toContain("DUPLICATE_SOURCES");
  });
  it("allows a clean merge", () => {
    expect(planMerge([A, B], C).allowed).toBe(true);
  });
});
