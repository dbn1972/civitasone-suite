/**
 * Boundary condition tests for Critical Path Scheduling, WBS Rollup, and EVM.
 *
 * Tests single task (no deps), max lag values, zero-duration tasks,
 * single leaf node, deeply nested (10 levels), zero weights.
 *
 * Validates: Requirements 23.3
 */
import { describe, it, expect } from "vitest";
import { computeCriticalPath, type TaskNode } from "../src/modules/scheduling/critical-path.js";
import { hasCycle, isValidLag, MAX_LAG_MS, MIN_LAG_MS } from "../src/modules/scheduling/domain.js";
import { rollupWbs, analyzeDelays, MAX_WBS_DEPTH, type WbsNode, type DelayAnalysisInput } from "../src/modules/scheduling/wbs.js";
import { computeEvm } from "../src/modules/scheduling/evm.js";

describe("Critical Path — Boundary Conditions", () => {
  describe("single task (no dependencies)", () => {
    it("returns the single task as the critical path", () => {
      const tasks: TaskNode[] = [
        { id: "T1", duration: 86400000n, deps: [] }, // 1 day in ms
      ];
      const result = computeCriticalPath(tasks);
      expect(result.criticalPath).toEqual(["T1"]);
      expect(result.projectDuration).toBe(86400000n);
      expect(result.floats.get("T1")).toBe(0n);
    });
  });

  describe("empty task list", () => {
    it("returns empty results for no tasks", () => {
      const result = computeCriticalPath([]);
      expect(result.criticalPath).toEqual([]);
      expect(result.projectDuration).toBe(0n);
    });
  });

  describe("zero-duration tasks", () => {
    it("handles a milestone task with zero duration", () => {
      const tasks: TaskNode[] = [
        { id: "T1", duration: 1000n, deps: [] },
        { id: "Milestone", duration: 0n, deps: [{ taskId: "T1", type: "FS", lag: 0n }] },
      ];
      const result = computeCriticalPath(tasks);
      expect(result.criticalPath).toContain("T1");
      expect(result.criticalPath).toContain("Milestone");
      expect(result.projectDuration).toBe(1000n);
    });

    it("handles all tasks with zero duration", () => {
      const tasks: TaskNode[] = [
        { id: "T1", duration: 0n, deps: [] },
        { id: "T2", duration: 0n, deps: [{ taskId: "T1", type: "FS", lag: 0n }] },
      ];
      const result = computeCriticalPath(tasks);
      expect(result.projectDuration).toBe(0n);
    });
  });

  describe("max lag values", () => {
    it("handles lag at maximum (+365 days)", () => {
      const maxLag = MAX_LAG_MS; // 31536000000n
      const tasks: TaskNode[] = [
        { id: "T1", duration: 1000n, deps: [] },
        { id: "T2", duration: 1000n, deps: [{ taskId: "T1", type: "FS", lag: maxLag }] },
      ];
      const result = computeCriticalPath(tasks);
      // T2 starts at T1 finish (1000) + lag (31536000000)
      expect(result.projectDuration).toBe(1000n + maxLag + 1000n);
    });

    it("validates lag at boundary", () => {
      expect(isValidLag(MAX_LAG_MS)).toBe(true);
      expect(isValidLag(MIN_LAG_MS)).toBe(true);
      expect(isValidLag(MAX_LAG_MS + 1n)).toBe(false);
      expect(isValidLag(MIN_LAG_MS - 1n)).toBe(false);
    });
  });
});

describe("Cycle Detection — Boundary Conditions", () => {
  it("returns null for empty dependency list (no cycle)", () => {
    expect(hasCycle([])).toBeNull();
  });

  it("returns null for a single dependency (no cycle)", () => {
    expect(hasCycle([{ fromTaskId: "A", toTaskId: "B" }])).toBeNull();
  });

  it("detects a direct self-loop", () => {
    const result = hasCycle([{ fromTaskId: "A", toTaskId: "A" }]);
    expect(result).not.toBeNull();
    expect(result).toContain("A");
  });

  it("detects a 2-node cycle", () => {
    const result = hasCycle([
      { fromTaskId: "A", toTaskId: "B" },
      { fromTaskId: "B", toTaskId: "A" },
    ]);
    expect(result).not.toBeNull();
  });
});

describe("WBS Rollup — Boundary Conditions", () => {
  describe("single leaf node", () => {
    it("returns its own values unchanged", () => {
      const nodes: WbsNode[] = [
        { id: "root", parentId: null, durationMs: 5000n, costPaise: 10000n, completionPct: 75, weightPct: 1 },
      ];
      const results = rollupWbs(nodes);
      expect(results).not.toBeNull();
      expect(results!).toHaveLength(1);
      expect(results![0]!.durationMs).toBe(5000n);
      expect(results![0]!.costPaise).toBe(10000n);
      expect(results![0]!.completionPct).toBe(75);
      expect(results![0]!.depth).toBe(0);
    });
  });

  describe("empty nodes array", () => {
    it("returns empty results", () => {
      const results = rollupWbs([]);
      expect(results).toEqual([]);
    });
  });

  describe("deeply nested (exactly 10 levels = max depth)", () => {
    it("returns null when depth exceeds MAX_WBS_DEPTH", () => {
      // Build 11 nodes: depth 0 through 10 (exceeds max of 10)
      const nodes: WbsNode[] = [];
      for (let i = 0; i <= MAX_WBS_DEPTH; i++) {
        nodes.push({
          id: `N${i}`,
          parentId: i === 0 ? null : `N${i - 1}`,
          durationMs: 1000n,
          costPaise: 100n,
          completionPct: 50,
          weightPct: 1,
        });
      }
      // This creates depth 10 for the last node, which should fail
      const results = rollupWbs(nodes);
      expect(results).toBeNull();
    });

    it("succeeds at exactly MAX_WBS_DEPTH - 1 levels deep", () => {
      // Build nodes at depth 0 through 9 (max valid)
      const nodes: WbsNode[] = [];
      for (let i = 0; i < MAX_WBS_DEPTH; i++) {
        nodes.push({
          id: `N${i}`,
          parentId: i === 0 ? null : `N${i - 1}`,
          durationMs: 1000n,
          costPaise: 100n,
          completionPct: 50,
          weightPct: 1,
        });
      }
      const results = rollupWbs(nodes);
      expect(results).not.toBeNull();
      expect(results!).toHaveLength(MAX_WBS_DEPTH);
    });
  });

  describe("zero weights", () => {
    it("returns 0 completion when all children have zero weight", () => {
      const nodes: WbsNode[] = [
        { id: "root", parentId: null, durationMs: 0n, costPaise: 0n, completionPct: 0, weightPct: 1 },
        { id: "c1", parentId: "root", durationMs: 1000n, costPaise: 500n, completionPct: 80, weightPct: 0 },
        { id: "c2", parentId: "root", durationMs: 2000n, costPaise: 300n, completionPct: 60, weightPct: 0 },
      ];
      const results = rollupWbs(nodes);
      expect(results).not.toBeNull();
      const root = results!.find((r) => r.id === "root");
      expect(root!.completionPct).toBe(0); // weighted avg with total weight 0 → 0
      expect(root!.durationMs).toBe(3000n); // sum of child durations
      expect(root!.costPaise).toBe(800n); // sum of child costs
    });
  });
});

describe("Delay Analysis — Boundary Conditions", () => {
  it("returns empty results when no tasks are delayed", () => {
    const inputs: DelayAnalysisInput[] = [
      { taskId: "T1", actualStartMs: 1000n, actualEndMs: 2000n, baselineStartMs: 1000n, baselineEndMs: 2000n, onCriticalPath: true },
    ];
    expect(analyzeDelays(inputs)).toHaveLength(0);
  });

  it("handles null actual dates (no delay reported)", () => {
    const inputs: DelayAnalysisInput[] = [
      { taskId: "T1", actualStartMs: null, actualEndMs: null, baselineStartMs: 1000n, baselineEndMs: 2000n, onCriticalPath: false },
    ];
    expect(analyzeDelays(inputs)).toHaveLength(0);
  });

  it("handles empty inputs array", () => {
    expect(analyzeDelays([])).toHaveLength(0);
  });
});

describe("EVM Metrics — Boundary Conditions", () => {
  describe("division by zero", () => {
    it("returns null SPI when PV is 0", () => {
      const result = computeEvm(0n, 5000n, 3000n);
      expect(result.spi).toBeNull();
      expect(result.cpi).not.toBeNull();
    });

    it("returns null CPI when AC is 0", () => {
      const result = computeEvm(5000n, 3000n, 0n);
      expect(result.cpi).toBeNull();
      expect(result.spi).not.toBeNull();
    });

    it("returns both null when PV and AC are both 0", () => {
      const result = computeEvm(0n, 0n, 0n);
      expect(result.spi).toBeNull();
      expect(result.cpi).toBeNull();
    });
  });

  describe("perfect performance", () => {
    it("returns SPI=1 and CPI=1 when EV equals PV and AC", () => {
      const result = computeEvm(10000n, 10000n, 10000n);
      expect(result.spi).toBe(1);
      expect(result.cpi).toBe(1);
    });
  });

  describe("bigint precision", () => {
    it("handles values near MAX_SAFE_INTEGER", () => {
      const big = 9_007_199_254_740_000n; // near 2^53
      const result = computeEvm(big, big, big);
      expect(result.spi).toBe(1);
      expect(result.cpi).toBe(1);
    });

    it("computes 4 decimal places correctly", () => {
      // EV = 3333, PV = 10000 → SPI = 0.3333
      const result = computeEvm(10000n, 3333n, 10000n);
      expect(result.spi).toBe(0.3333);
    });
  });
});
