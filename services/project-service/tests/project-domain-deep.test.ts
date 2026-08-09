/**
 * Project Service — Domain Logic: Deep tests.
 *
 * Tests task status machine, milestone completion, physical progress validation,
 * DPR duplicate prevention, scheduling cycle detection, and lag/dep-type validation.
 *
 * Source: modules/project/domain.ts, modules/progress/domain.ts, modules/scheduling/domain.ts
 */
import { describe, it, expect } from "vitest";
import {
  assertTaskTransitionAllowed, assertMilestoneCanComplete,
  DomainError as ProjectDomainError, type TaskStatus,
} from "../src/modules/project/domain.js";
import { assertPhysicalPctValid, assertDprDateUnique, DomainError as ProgressDomainError } from "../src/modules/progress/domain.js";
import { hasCycle, isValidLag, isValidDepType, MAX_LAG_MS, MIN_LAG_MS, MAX_DEPS_PER_TASK, DEP_TYPES, type TaskDep } from "../src/modules/scheduling/domain.js";

// ═══ Task Status Machine ═══

describe("assertTaskTransitionAllowed", () => {
  const valid: [string, string][] = [
    ["pending", "in_progress"], ["pending", "blocked"],
    ["in_progress", "completed"], ["in_progress", "blocked"], ["in_progress", "pending"],
    ["blocked", "pending"], ["blocked", "in_progress"],
  ];
  for (const [from, to] of valid) {
    it(`${from} → ${to}`, () => expect(() => assertTaskTransitionAllowed(from, to)).not.toThrow());
  }

  const invalid: [string, string][] = [
    ["pending", "completed"], // must go through in_progress
    ["completed", "pending"], ["completed", "in_progress"], ["completed", "blocked"],
    ["blocked", "completed"],
  ];
  for (const [from, to] of invalid) {
    it(`${from} → ${to} is illegal`, () => expect(() => assertTaskTransitionAllowed(from, to)).toThrow("INVALID_TRANSITION"));
  }

  it("completed is terminal", () => {
    for (const target of ["pending", "in_progress", "blocked"] as TaskStatus[]) {
      expect(() => assertTaskTransitionAllowed("completed", target)).toThrow(ProjectDomainError);
    }
  });
});

// ═══ Milestone ═══

describe("assertMilestoneCanComplete", () => {
  it("passes for pending milestone", () => {
    expect(() => assertMilestoneCanComplete("pending")).not.toThrow();
  });
  it("throws MILESTONE_NOT_PENDING for completed", () => {
    expect(() => assertMilestoneCanComplete("completed")).toThrow("MILESTONE_NOT_PENDING");
  });
  it("throws for in_progress", () => {
    expect(() => assertMilestoneCanComplete("in_progress")).toThrow(ProjectDomainError);
  });
});

// ═══ Progress ═══

describe("assertPhysicalPctValid", () => {
  it("passes for 0", () => expect(() => assertPhysicalPctValid(0)).not.toThrow());
  it("passes for 100", () => expect(() => assertPhysicalPctValid(100)).not.toThrow());
  it("passes for 50", () => expect(() => assertPhysicalPctValid(50)).not.toThrow());
  it("throws INVALID_PHYSICAL_PCT for -1", () => expect(() => assertPhysicalPctValid(-1)).toThrow("INVALID_PHYSICAL_PCT"));
  it("throws for 101", () => expect(() => assertPhysicalPctValid(101)).toThrow(ProgressDomainError));
});

describe("assertDprDateUnique", () => {
  it("passes when no existing DPR", () => {
    expect(() => assertDprDateUnique(false, "2026-07-15")).not.toThrow();
  });
  it("throws DPR_DATE_DUPLICATE when already exists", () => {
    expect(() => assertDprDateUnique(true, "2026-07-15")).toThrow("DPR_DATE_DUPLICATE");
  });
});

// ═══ Scheduling — Cycle Detection ═══

describe("hasCycle — dependency graph analysis", () => {
  it("returns null for acyclic graph", () => {
    const deps: TaskDep[] = [
      { fromTaskId: "A", toTaskId: "B" },
      { fromTaskId: "B", toTaskId: "C" },
    ];
    expect(hasCycle(deps)).toBeNull();
  });

  it("detects a simple cycle (A→B→A)", () => {
    const deps: TaskDep[] = [
      { fromTaskId: "A", toTaskId: "B" },
      { fromTaskId: "B", toTaskId: "A" },
    ];
    const cycle = hasCycle(deps);
    expect(cycle).not.toBeNull();
    expect(cycle!.length).toBeGreaterThanOrEqual(2);
  });

  it("detects a longer cycle (A→B→C→A)", () => {
    const deps: TaskDep[] = [
      { fromTaskId: "A", toTaskId: "B" },
      { fromTaskId: "B", toTaskId: "C" },
      { fromTaskId: "C", toTaskId: "A" },
    ];
    expect(hasCycle(deps)).not.toBeNull();
  });

  it("returns null for empty graph", () => {
    expect(hasCycle([])).toBeNull();
  });

  it("returns null for linear chain", () => {
    const deps: TaskDep[] = [
      { fromTaskId: "A", toTaskId: "B" },
      { fromTaskId: "B", toTaskId: "C" },
      { fromTaskId: "C", toTaskId: "D" },
    ];
    expect(hasCycle(deps)).toBeNull();
  });

  it("detects self-loop", () => {
    const deps: TaskDep[] = [{ fromTaskId: "A", toTaskId: "A" }];
    expect(hasCycle(deps)).not.toBeNull();
  });
});

// ═══ Scheduling — Validation ═══

describe("isValidLag", () => {
  it("accepts zero lag", () => expect(isValidLag(0n)).toBe(true));
  it("accepts positive within bounds", () => expect(isValidLag(1000000n)).toBe(true));
  it("accepts negative (lead) within bounds", () => expect(isValidLag(-1000000n)).toBe(true));
  it("accepts MAX_LAG_MS boundary", () => expect(isValidLag(MAX_LAG_MS)).toBe(true));
  it("accepts MIN_LAG_MS boundary", () => expect(isValidLag(MIN_LAG_MS)).toBe(true));
  it("rejects beyond MAX", () => expect(isValidLag(MAX_LAG_MS + 1n)).toBe(false));
  it("rejects beyond MIN", () => expect(isValidLag(MIN_LAG_MS - 1n)).toBe(false));
});

describe("isValidDepType", () => {
  it("accepts all 4 standard types", () => {
    for (const t of DEP_TYPES) expect(isValidDepType(t)).toBe(true);
  });
  it("rejects unknown type", () => expect(isValidDepType("XY")).toBe(false));
  it("rejects empty", () => expect(isValidDepType("")).toBe(false));
});

describe("MAX_DEPS_PER_TASK", () => {
  it("is 50", () => expect(MAX_DEPS_PER_TASK).toBe(50));
});
