/**
 * Critical Path Method (CPM) tests — pure domain logic.
 *
 * Tests cover:
 * - Single task (trivial case)
 * - Simple chain (A→B→C, all FS)
 * - Parallel paths with float computation
 * - Complex DAG with mixed dependency types
 * - Lag/lead effects on scheduling
 * - All 4 dependency types (FS, SS, FF, SF)
 * - Empty task list (edge case)
 */
import { describe, it, expect } from "vitest";
import { computeCriticalPath, type TaskNode } from "../src/modules/scheduling/critical-path.js";

describe("computeCriticalPath — single task", () => {
  it("returns the single task as critical path with zero float", () => {
    const tasks: TaskNode[] = [
      { id: "A", duration: 5000n, deps: [] },
    ];
    const result = computeCriticalPath(tasks);

    expect(result.criticalPath).toEqual(["A"]);
    expect(result.floats.get("A")).toBe(0n);
    expect(result.projectDuration).toBe(5000n);
  });
});

describe("computeCriticalPath — empty task list", () => {
  it("returns empty results for no tasks", () => {
    const result = computeCriticalPath([]);

    expect(result.criticalPath).toEqual([]);
    expect(result.floats.size).toBe(0);
    expect(result.projectDuration).toBe(0n);
  });
});

describe("computeCriticalPath — simple chain (FS)", () => {
  it("computes correct duration for A→B→C linear chain", () => {
    // A(3000ms) → B(2000ms) → C(4000ms)
    // Project duration = 3000 + 2000 + 4000 = 9000ms
    // All tasks are on the critical path (zero float)
    const tasks: TaskNode[] = [
      { id: "A", duration: 3000n, deps: [] },
      { id: "B", duration: 2000n, deps: [{ taskId: "A", type: "FS", lag: 0n }] },
      { id: "C", duration: 4000n, deps: [{ taskId: "B", type: "FS", lag: 0n }] },
    ];
    const result = computeCriticalPath(tasks);

    expect(result.projectDuration).toBe(9000n);
    expect(result.criticalPath).toEqual(["A", "B", "C"]);
    expect(result.floats.get("A")).toBe(0n);
    expect(result.floats.get("B")).toBe(0n);
    expect(result.floats.get("C")).toBe(0n);
  });

  it("handles FS with lag", () => {
    // A(2000ms) --FS+1000ms--> B(3000ms)
    // ES(A)=0, EF(A)=2000
    // ES(B)=2000+1000=3000, EF(B)=6000
    // Project duration = 6000ms
    const tasks: TaskNode[] = [
      { id: "A", duration: 2000n, deps: [] },
      { id: "B", duration: 3000n, deps: [{ taskId: "A", type: "FS", lag: 1000n }] },
    ];
    const result = computeCriticalPath(tasks);

    expect(result.projectDuration).toBe(6000n);
    expect(result.criticalPath).toEqual(["A", "B"]);
  });
});

describe("computeCriticalPath — parallel paths with float", () => {
  it("identifies critical path and computes float for non-critical tasks", () => {
    // Two parallel paths converging at D:
    //   A(5000) → B(3000) → D(2000)     path length = 10000
    //   A(5000) → C(1000) → D(2000)     path length = 8000
    //
    // Critical path: A → B → D (longest = 10000ms)
    // C has float = 10000 - 8000 = 2000ms
    const tasks: TaskNode[] = [
      { id: "A", duration: 5000n, deps: [] },
      { id: "B", duration: 3000n, deps: [{ taskId: "A", type: "FS", lag: 0n }] },
      { id: "C", duration: 1000n, deps: [{ taskId: "A", type: "FS", lag: 0n }] },
      { id: "D", duration: 2000n, deps: [
        { taskId: "B", type: "FS", lag: 0n },
        { taskId: "C", type: "FS", lag: 0n },
      ]},
    ];
    const result = computeCriticalPath(tasks);

    expect(result.projectDuration).toBe(10000n);
    expect(result.criticalPath).toContain("A");
    expect(result.criticalPath).toContain("B");
    expect(result.criticalPath).toContain("D");
    expect(result.criticalPath).not.toContain("C");
    expect(result.floats.get("A")).toBe(0n);
    expect(result.floats.get("B")).toBe(0n);
    expect(result.floats.get("D")).toBe(0n);
    expect(result.floats.get("C")).toBe(2000n);
  });

  it("handles diamond pattern (common in project scheduling)", () => {
    // Start → (Path1: 8000ms total) → End
    // Start → (Path2: 6000ms total) → End
    //
    //   Start(1000) → M1(4000) → End(3000)   total = 8000
    //   Start(1000) → M2(2000) → End(3000)   total = 6000
    //
    // Critical path: Start → M1 → End
    // M2 has float = 2000ms
    const tasks: TaskNode[] = [
      { id: "Start", duration: 1000n, deps: [] },
      { id: "M1", duration: 4000n, deps: [{ taskId: "Start", type: "FS", lag: 0n }] },
      { id: "M2", duration: 2000n, deps: [{ taskId: "Start", type: "FS", lag: 0n }] },
      { id: "End", duration: 3000n, deps: [
        { taskId: "M1", type: "FS", lag: 0n },
        { taskId: "M2", type: "FS", lag: 0n },
      ]},
    ];
    const result = computeCriticalPath(tasks);

    expect(result.projectDuration).toBe(8000n);
    expect(result.criticalPath).toContain("Start");
    expect(result.criticalPath).toContain("M1");
    expect(result.criticalPath).toContain("End");
    expect(result.criticalPath).not.toContain("M2");
    expect(result.floats.get("M2")).toBe(2000n);
  });
});

describe("computeCriticalPath — Start-to-Start (SS) dependency", () => {
  it("constrains successor start to predecessor start + lag", () => {
    // A(4000) --SS+1000--> B(2000)
    // ES(A) = 0, EF(A) = 4000
    // ES(B) = 0 + 1000 = 1000, EF(B) = 3000
    // Project duration = max(4000, 3000) = 4000
    // A is critical (float=0), B has float = 4000 - 3000 = 1000
    const tasks: TaskNode[] = [
      { id: "A", duration: 4000n, deps: [] },
      { id: "B", duration: 2000n, deps: [{ taskId: "A", type: "SS", lag: 1000n }] },
    ];
    const result = computeCriticalPath(tasks);

    expect(result.projectDuration).toBe(4000n);
    expect(result.criticalPath).toContain("A");
    expect(result.floats.get("B")).toBe(1000n);
  });

  it("handles SS where successor determines project duration", () => {
    // A(2000) --SS+0--> B(5000)
    // ES(A) = 0, EF(A) = 2000
    // ES(B) = 0, EF(B) = 5000
    // Project duration = 5000
    const tasks: TaskNode[] = [
      { id: "A", duration: 2000n, deps: [] },
      { id: "B", duration: 5000n, deps: [{ taskId: "A", type: "SS", lag: 0n }] },
    ];
    const result = computeCriticalPath(tasks);

    expect(result.projectDuration).toBe(5000n);
    expect(result.criticalPath).toContain("B");
  });
});

describe("computeCriticalPath — Finish-to-Finish (FF) dependency", () => {
  it("constrains successor finish to predecessor finish + lag", () => {
    // A(4000) --FF+0--> B(2000)
    // ES(A) = 0, EF(A) = 4000
    // For B: FF constraint means EF(B) >= EF(A) + lag = 4000
    //   So ES(B) = 4000 - 2000 = 2000, EF(B) = 4000
    // Project duration = 4000
    const tasks: TaskNode[] = [
      { id: "A", duration: 4000n, deps: [] },
      { id: "B", duration: 2000n, deps: [{ taskId: "A", type: "FF", lag: 0n }] },
    ];
    const result = computeCriticalPath(tasks);

    expect(result.projectDuration).toBe(4000n);
    // Both should be on critical path (both have zero float since they finish at same time)
    expect(result.floats.get("A")).toBe(0n);
    expect(result.floats.get("B")).toBe(0n);
  });

  it("handles FF with lag extending project duration", () => {
    // A(3000) --FF+2000--> B(1000)
    // ES(A) = 0, EF(A) = 3000
    // For B: EF(B) >= 3000 + 2000 = 5000, so ES(B) = 5000 - 1000 = 4000
    // Project duration = 5000
    const tasks: TaskNode[] = [
      { id: "A", duration: 3000n, deps: [] },
      { id: "B", duration: 1000n, deps: [{ taskId: "A", type: "FF", lag: 2000n }] },
    ];
    const result = computeCriticalPath(tasks);

    expect(result.projectDuration).toBe(5000n);
    expect(result.criticalPath).toContain("A");
    expect(result.criticalPath).toContain("B");
  });
});

describe("computeCriticalPath — Start-to-Finish (SF) dependency", () => {
  it("constrains successor finish to predecessor start + lag", () => {
    // A(3000) --SF+5000--> B(2000)
    // ES(A) = 0, EF(A) = 3000
    // For B: SF means EF(B) >= ES(A) + lag = 0 + 5000 = 5000
    //   So ES(B) = 5000 - 2000 = 3000, EF(B) = 5000
    // Project duration = 5000
    const tasks: TaskNode[] = [
      { id: "A", duration: 3000n, deps: [] },
      { id: "B", duration: 2000n, deps: [{ taskId: "A", type: "SF", lag: 5000n }] },
    ];
    const result = computeCriticalPath(tasks);

    expect(result.projectDuration).toBe(5000n);
  });
});

describe("computeCriticalPath — complex DAG", () => {
  it("handles a multi-path DAG with mixed dependency types", () => {
    // Complex graph:
    //   A(2000) → B(3000) [FS]
    //   A(2000) → C(4000) [FS]
    //   B(3000) → D(1000) [FS]
    //   C(4000) → D(1000) [FS]
    //   D(1000) → E(2000) [FS]
    //
    // Paths:
    //   A→B→D→E = 2000+3000+1000+2000 = 8000
    //   A→C→D→E = 2000+4000+1000+2000 = 9000 (critical)
    //
    // B has float = 9000 - 8000 = 1000
    const tasks: TaskNode[] = [
      { id: "A", duration: 2000n, deps: [] },
      { id: "B", duration: 3000n, deps: [{ taskId: "A", type: "FS", lag: 0n }] },
      { id: "C", duration: 4000n, deps: [{ taskId: "A", type: "FS", lag: 0n }] },
      { id: "D", duration: 1000n, deps: [
        { taskId: "B", type: "FS", lag: 0n },
        { taskId: "C", type: "FS", lag: 0n },
      ]},
      { id: "E", duration: 2000n, deps: [{ taskId: "D", type: "FS", lag: 0n }] },
    ];
    const result = computeCriticalPath(tasks);

    expect(result.projectDuration).toBe(9000n);
    expect(result.criticalPath).toContain("A");
    expect(result.criticalPath).toContain("C");
    expect(result.criticalPath).toContain("D");
    expect(result.criticalPath).toContain("E");
    expect(result.criticalPath).not.toContain("B");
    expect(result.floats.get("B")).toBe(1000n);
    expect(result.floats.get("A")).toBe(0n);
    expect(result.floats.get("C")).toBe(0n);
    expect(result.floats.get("D")).toBe(0n);
    expect(result.floats.get("E")).toBe(0n);
  });

  it("handles DAG with multiple start and end nodes", () => {
    // Multiple starts (A, B) and multiple ends (D, E):
    //   A(3000) → C(2000) → D(1000)   path = 6000
    //   B(4000) → C(2000) → D(1000)   path = 7000
    //   A(3000) → E(2000)              path = 5000
    //
    // Project duration = max(6000, 7000, 5000) = 7000
    // Critical path: B → C → D
    const tasks: TaskNode[] = [
      { id: "A", duration: 3000n, deps: [] },
      { id: "B", duration: 4000n, deps: [] },
      { id: "C", duration: 2000n, deps: [
        { taskId: "A", type: "FS", lag: 0n },
        { taskId: "B", type: "FS", lag: 0n },
      ]},
      { id: "D", duration: 1000n, deps: [{ taskId: "C", type: "FS", lag: 0n }] },
      { id: "E", duration: 2000n, deps: [{ taskId: "A", type: "FS", lag: 0n }] },
    ];
    const result = computeCriticalPath(tasks);

    expect(result.projectDuration).toBe(7000n);
    expect(result.criticalPath).toContain("B");
    expect(result.criticalPath).toContain("C");
    expect(result.criticalPath).toContain("D");
    // A feeds into both critical (C) and non-critical (E) paths
    // A's float depends on whether it can be delayed:
    //   EF(A) = 3000, LF(A) comes from C's LS - 0 = 4000 (since C's LS = 4000 because B→C is critical)
    //   Also from E's LF = 7000 - 2000 = 5000
    //   LF(A) = min(4000, 5000) = 4000, float = 4000 - 3000 = 1000
    expect(result.floats.get("A")).toBe(1000n);
    expect(result.floats.get("B")).toBe(0n);
  });

  it("handles DAG with negative lag (lead) on FS", () => {
    // A(4000) --FS-1000(lead)--> B(3000)
    // ES(A) = 0, EF(A) = 4000
    // ES(B) = 4000 + (-1000) = 3000, EF(B) = 6000
    // Project duration = 6000
    const tasks: TaskNode[] = [
      { id: "A", duration: 4000n, deps: [] },
      { id: "B", duration: 3000n, deps: [{ taskId: "A", type: "FS", lag: -1000n }] },
    ];
    const result = computeCriticalPath(tasks);

    expect(result.projectDuration).toBe(6000n);
    expect(result.criticalPath).toContain("A");
    expect(result.criticalPath).toContain("B");
  });

  it("handles complex DAG with SS and FF dependencies", () => {
    // A(5000), B(3000), C(2000)
    // A --SS+1000--> B : B can't start until 1s after A starts
    //   ES(B) = 0 + 1000 = 1000, EF(B) = 4000
    // A --FF+0--> C : C can't finish until A finishes
    //   ES(C) = 5000 - 2000 = 3000, EF(C) = 5000
    // Project duration = max(5000, 4000, 5000) = 5000
    const tasks: TaskNode[] = [
      { id: "A", duration: 5000n, deps: [] },
      { id: "B", duration: 3000n, deps: [{ taskId: "A", type: "SS", lag: 1000n }] },
      { id: "C", duration: 2000n, deps: [{ taskId: "A", type: "FF", lag: 0n }] },
    ];
    const result = computeCriticalPath(tasks);

    expect(result.projectDuration).toBe(5000n);
    expect(result.criticalPath).toContain("A");
    // B: EF=4000, LF=5000, float=1000
    expect(result.floats.get("B")).toBe(1000n);
    // C: EF=5000, LF=5000, float=0
    expect(result.floats.get("C")).toBe(0n);
  });

  it("handles independent parallel tasks (no dependencies)", () => {
    // A(3000), B(5000), C(2000) — all independent
    // Project duration = max(3000, 5000, 2000) = 5000
    // B is critical, A and C have float
    const tasks: TaskNode[] = [
      { id: "A", duration: 3000n, deps: [] },
      { id: "B", duration: 5000n, deps: [] },
      { id: "C", duration: 2000n, deps: [] },
    ];
    const result = computeCriticalPath(tasks);

    expect(result.projectDuration).toBe(5000n);
    expect(result.criticalPath).toContain("B");
    expect(result.floats.get("B")).toBe(0n);
    expect(result.floats.get("A")).toBe(2000n);
    expect(result.floats.get("C")).toBe(3000n);
  });

  it("handles tasks with zero duration (milestones)", () => {
    // A(3000) → M(0) → B(2000)
    // Project duration = 3000 + 0 + 2000 = 5000
    const tasks: TaskNode[] = [
      { id: "A", duration: 3000n, deps: [] },
      { id: "M", duration: 0n, deps: [{ taskId: "A", type: "FS", lag: 0n }] },
      { id: "B", duration: 2000n, deps: [{ taskId: "M", type: "FS", lag: 0n }] },
    ];
    const result = computeCriticalPath(tasks);

    expect(result.projectDuration).toBe(5000n);
    expect(result.criticalPath).toContain("A");
    expect(result.criticalPath).toContain("M");
    expect(result.criticalPath).toContain("B");
    expect(result.floats.get("M")).toBe(0n);
  });
});

describe("computeCriticalPath — float computation invariants", () => {
  it("total float is always non-negative", () => {
    const tasks: TaskNode[] = [
      { id: "A", duration: 1000n, deps: [] },
      { id: "B", duration: 2000n, deps: [{ taskId: "A", type: "FS", lag: 0n }] },
      { id: "C", duration: 500n, deps: [{ taskId: "A", type: "FS", lag: 0n }] },
      { id: "D", duration: 1000n, deps: [
        { taskId: "B", type: "FS", lag: 0n },
        { taskId: "C", type: "FS", lag: 0n },
      ]},
    ];
    const result = computeCriticalPath(tasks);

    for (const [, float] of result.floats) {
      expect(float >= 0n).toBe(true);
    }
  });

  it("critical path tasks always have zero float", () => {
    const tasks: TaskNode[] = [
      { id: "A", duration: 3000n, deps: [] },
      { id: "B", duration: 4000n, deps: [{ taskId: "A", type: "FS", lag: 0n }] },
      { id: "C", duration: 2000n, deps: [{ taskId: "A", type: "FS", lag: 0n }] },
      { id: "D", duration: 1000n, deps: [
        { taskId: "B", type: "FS", lag: 0n },
        { taskId: "C", type: "FS", lag: 0n },
      ]},
    ];
    const result = computeCriticalPath(tasks);

    for (const taskId of result.criticalPath) {
      expect(result.floats.get(taskId)).toBe(0n);
    }
  });

  it("project duration equals sum of critical path durations for simple FS chains", () => {
    // For pure FS chains with zero lag, project duration = sum of critical task durations
    const tasks: TaskNode[] = [
      { id: "A", duration: 2000n, deps: [] },
      { id: "B", duration: 3000n, deps: [{ taskId: "A", type: "FS", lag: 0n }] },
      { id: "C", duration: 4000n, deps: [{ taskId: "B", type: "FS", lag: 0n }] },
    ];
    const result = computeCriticalPath(tasks);

    const criticalDuration = result.criticalPath.reduce((sum, id) => {
      const task = tasks.find(t => t.id === id)!;
      return sum + task.duration;
    }, 0n);

    expect(criticalDuration).toBe(result.projectDuration);
  });
});
