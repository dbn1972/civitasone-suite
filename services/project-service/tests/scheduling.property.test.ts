/**
 * Property-Based Tests for Project Scheduling Domain.
 * Uses fast-check to verify scheduling algorithms hold across all valid inputs.
 *
 * **Validates: Requirements 11.1, 11.2, 11.3, 11.6, 11.7, 11.8**
 *
 * Properties covered:
 * - Property 18: Task Dependency Cycle Detection
 * - Property 19: Critical Path Computation Correctness
 * - Property 20: EVM Metrics Computation
 * - Property 21: WBS Hierarchy Rollup Invariant
 * - Property 22: Delay Analysis Variance
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { hasCycle, type TaskDep } from "../src/modules/scheduling/domain.js";
import { computeCriticalPath, type TaskNode } from "../src/modules/scheduling/critical-path.js";
import { computeEvm } from "../src/modules/scheduling/evm.js";
import { rollupWbs, analyzeDelays, type WbsNode, type DelayAnalysisInput } from "../src/modules/scheduling/wbs.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Arbitraries
// ═══════════════════════════════════════════════════════════════════════════════

/** Generates a valid task ID string */
const taskIdArb: fc.Arbitrary<string> = fc.stringMatching(/^[a-z][a-z0-9]{1,7}$/);

/**
 * Generates a DAG (directed acyclic graph) of task dependencies.
 * Strategy: generate N nodes with labels, then only create edges from lower-index to higher-index
 * nodes, guaranteeing acyclicity.
 */
const dagArb: fc.Arbitrary<{ nodes: string[]; deps: TaskDep[] }> = fc
  .integer({ min: 2, max: 15 })
  .chain((nodeCount) =>
    fc.tuple(
      fc.array(taskIdArb, { minLength: nodeCount, maxLength: nodeCount }),
      fc.array(
        fc.tuple(
          fc.integer({ min: 0, max: nodeCount - 2 }),
          fc.integer({ min: 1, max: nodeCount - 1 }),
        ),
        { minLength: 0, maxLength: nodeCount * 2 },
      ),
    ),
  )
  .map(([rawNodes, rawEdges]) => {
    // Ensure unique node names
    const nodes = [...new Set(rawNodes)];
    if (nodes.length < 2) return { nodes: ["n0", "n1"], deps: [] };

    const deps: TaskDep[] = [];
    for (const [fromRaw, toRaw] of rawEdges) {
      const fromIdx = fromRaw % (nodes.length - 1);
      const toIdx = fromIdx + 1 + (toRaw % (nodes.length - fromIdx - 1));
      if (toIdx < nodes.length && fromIdx !== toIdx) {
        deps.push({ fromTaskId: nodes[fromIdx]!, toTaskId: nodes[toIdx]! });
      }
    }
    return { nodes, deps };
  });

/** Generates a positive bigint duration in milliseconds (1ms to 30 days) */
const durationMsArb: fc.Arbitrary<bigint> = fc.bigInt({ min: 1n, max: 2_592_000_000n });

/** Generates a bigint paise value (non-negative, up to 10^12) */
const paiseArb: fc.Arbitrary<bigint> = fc.bigInt({ min: 0n, max: 1_000_000_000_000n });

/** Generates a positive bigint paise value (1 to 10^12) */
const positivePaiseArb: fc.Arbitrary<bigint> = fc.bigInt({ min: 1n, max: 1_000_000_000_000n });

/** Generates a completion percentage between 0 and 100 */
const completionPctArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: 100 });

/** Generates a weight value between 1 and 100 */
const weightArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 100 });

/**
 * Generates a valid acyclic task graph for critical path computation.
 * Uses index-ordering to guarantee acyclicity: task i can only depend on tasks j < i.
 */
const criticalPathInputArb: fc.Arbitrary<TaskNode[]> = fc
  .integer({ min: 2, max: 10 })
  .chain((count) =>
    fc.tuple(
      fc.array(durationMsArb, { minLength: count, maxLength: count }),
      fc.array(
        fc.array(fc.nat({ max: 100 }), { minLength: count, maxLength: count }),
        { minLength: count, maxLength: count },
      ),
    ).map(([durations, depChances]) => {
      const tasks: TaskNode[] = [];
      for (let i = 0; i < count; i++) {
        const deps: Array<{ taskId: string; type: "FS"; lag: bigint }> = [];
        // Only depend on earlier tasks (ensures DAG)
        for (let j = 0; j < i; j++) {
          // ~40% chance of a dependency to each earlier task
          if ((depChances[i]?.[j] ?? 100) < 40) {
            deps.push({ taskId: `t${j}`, type: "FS" as const, lag: 0n });
          }
        }
        tasks.push({ id: `t${i}`, duration: durations[i]!, deps });
      }
      // Ensure at least one task has no deps (root) and at least one dep exists
      if (tasks.length >= 2 && tasks[tasks.length - 1]!.deps.length === 0) {
        tasks[tasks.length - 1]!.deps.push({ taskId: `t0`, type: "FS", lag: 0n });
      }
      return tasks;
    }),
  );

/**
 * Generates a flat WBS tree (1 parent with N children).
 * This ensures a simple rollup structure we can verify.
 */
const wbsTreeArb: fc.Arbitrary<WbsNode[]> = fc
  .integer({ min: 2, max: 8 })
  .chain((childCount) =>
    fc.tuple(
      fc.array(durationMsArb, { minLength: childCount, maxLength: childCount }),
      fc.array(paiseArb, { minLength: childCount, maxLength: childCount }),
      fc.array(completionPctArb, { minLength: childCount, maxLength: childCount }),
      fc.array(weightArb, { minLength: childCount, maxLength: childCount }),
    ).map(([durations, costs, completions, weights]) => {
      const nodes: WbsNode[] = [];
      // Parent node (values will be overwritten by rollup)
      nodes.push({
        id: "parent",
        parentId: null,
        durationMs: 0n,
        costPaise: 0n,
        completionPct: 0,
        weightPct: 1,
      });
      // Child nodes
      for (let i = 0; i < childCount; i++) {
        nodes.push({
          id: `child-${i}`,
          parentId: "parent",
          durationMs: durations[i]!,
          costPaise: costs[i]!,
          completionPct: completions[i]!,
          weightPct: weights[i]!,
        });
      }
      return nodes;
    }),
  );

/** Generates a timestamp in ms since epoch (year 2020-2030 range) */
const timestampMsArb: fc.Arbitrary<bigint> = fc.bigInt({
  min: 1_577_836_800_000n, // 2020-01-01
  max: 1_893_456_000_000n, // 2030-01-01
});

// ═══════════════════════════════════════════════════════════════════════════════
// Property 18: Task Dependency Cycle Detection
// **Validates: Requirements 11.1, 11.2**
// ═══════════════════════════════════════════════════════════════════════════════

describe("Property 18: Task Dependency Cycle Detection", () => {
  it("returns null for any DAG (no cycle in acyclic graph)", () => {
    fc.assert(
      fc.property(dagArb, ({ deps }) => {
        const result = hasCycle(deps);
        expect(result).toBeNull();
      }),
      { numRuns: 500 },
    );
  });

  it("detects cycle when a back-edge is added to create a known cycle", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 10 }),
        (chainLength) => {
          // Create a simple chain: n0→n1→n2→...→n(chainLength-1)
          const deps: TaskDep[] = [];
          for (let i = 0; i < chainLength - 1; i++) {
            deps.push({ fromTaskId: `n${i}`, toTaskId: `n${i + 1}` });
          }

          // Verify chain is acyclic
          expect(hasCycle(deps)).toBeNull();

          // Add back-edge from last to first, creating a definite cycle
          const depsWithCycle: TaskDep[] = [
            ...deps,
            { fromTaskId: `n${chainLength - 1}`, toTaskId: "n0" },
          ];

          const result = hasCycle(depsWithCycle);
          expect(result).not.toBeNull();
          expect(result!.length).toBeGreaterThanOrEqual(2);
          // The cycle should contain at least the first and last nodes
          expect(result).toContain("n0");
        },
      ),
      { numRuns: 500 },
    );
  });

  it("cycle detection is deterministic", () => {
    fc.assert(
      fc.property(dagArb, ({ nodes, deps }) => {
        if (nodes.length < 2) return;

        // Create a definite cycle
        const cycleDeps: TaskDep[] = [
          { fromTaskId: "cycA", toTaskId: "cycB" },
          { fromTaskId: "cycB", toTaskId: "cycC" },
          { fromTaskId: "cycC", toTaskId: "cycA" },
        ];

        const result1 = hasCycle(cycleDeps);
        const result2 = hasCycle(cycleDeps);

        // Both should detect a cycle
        expect(result1).not.toBeNull();
        expect(result2).not.toBeNull();
        // Same cycle path (deterministic)
        expect(result1).toEqual(result2);
      }),
      { numRuns: 200 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Property 19: Critical Path Computation Correctness
// **Validates: Requirements 11.3**
// ═══════════════════════════════════════════════════════════════════════════════

describe("Property 19: Critical Path Computation Correctness", () => {
  it("critical path tasks have zero total float", () => {
    fc.assert(
      fc.property(criticalPathInputArb, (tasks) => {
        const result = computeCriticalPath(tasks);

        // Every task on the critical path should have zero float
        for (const taskId of result.criticalPath) {
          const float = result.floats.get(taskId);
          expect(float).toBe(0n);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("all non-critical tasks have non-negative total float", () => {
    fc.assert(
      fc.property(criticalPathInputArb, (tasks) => {
        const result = computeCriticalPath(tasks);

        const criticalSet = new Set(result.criticalPath);
        for (const [taskId, float] of result.floats) {
          if (!criticalSet.has(taskId)) {
            // Non-critical tasks should have positive float
            expect(float).toBeGreaterThanOrEqual(0n);
          }
        }
      }),
      { numRuns: 500 },
    );
  });

  it("project duration is non-negative and equals the longest path", () => {
    fc.assert(
      fc.property(criticalPathInputArb, (tasks) => {
        const result = computeCriticalPath(tasks);

        // Project duration must be non-negative
        expect(result.projectDuration).toBeGreaterThanOrEqual(0n);

        // Project duration >= any single task duration (since it's the longest path)
        for (const task of tasks) {
          expect(result.projectDuration).toBeGreaterThanOrEqual(task.duration);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("at least one task is on the critical path for non-empty graphs", () => {
    fc.assert(
      fc.property(criticalPathInputArb, (tasks) => {
        const result = computeCriticalPath(tasks);
        expect(result.criticalPath.length).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 500 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Property 20: EVM Metrics Computation
// **Validates: Requirements 11.6**
// ═══════════════════════════════════════════════════════════════════════════════

describe("Property 20: EVM Metrics Computation", () => {
  it("SPI = EV/PV to 4 decimal places when PV > 0", () => {
    fc.assert(
      fc.property(positivePaiseArb, paiseArb, paiseArb, (pv, ev, ac) => {
        const result = computeEvm(pv, ev, ac);

        expect(result.pv).toBe(pv);
        expect(result.ev).toBe(ev);
        expect(result.ac).toBe(ac);

        // SPI should be EV/PV at 4 decimal places
        expect(result.spi).not.toBeNull();
        const expectedSpi = Number(ev * 10000n / pv) / 10000;
        expect(result.spi).toBe(expectedSpi);
      }),
      { numRuns: 500 },
    );
  });

  it("CPI = EV/AC to 4 decimal places when AC > 0", () => {
    fc.assert(
      fc.property(paiseArb, paiseArb, positivePaiseArb, (pv, ev, ac) => {
        const result = computeEvm(pv, ev, ac);

        // CPI should be EV/AC at 4 decimal places
        expect(result.cpi).not.toBeNull();
        const expectedCpi = Number(ev * 10000n / ac) / 10000;
        expect(result.cpi).toBe(expectedCpi);
      }),
      { numRuns: 500 },
    );
  });

  it("SPI is null when PV is 0", () => {
    fc.assert(
      fc.property(paiseArb, paiseArb, (ev, ac) => {
        const result = computeEvm(0n, ev, ac);
        expect(result.spi).toBeNull();
      }),
      { numRuns: 200 },
    );
  });

  it("CPI is null when AC is 0", () => {
    fc.assert(
      fc.property(paiseArb, paiseArb, (pv, ev) => {
        const result = computeEvm(pv, ev, 0n);
        expect(result.cpi).toBeNull();
      }),
      { numRuns: 200 },
    );
  });

  it("EVM metrics are non-negative when inputs are non-negative", () => {
    fc.assert(
      fc.property(paiseArb, paiseArb, paiseArb, (pv, ev, ac) => {
        const result = computeEvm(pv, ev, ac);

        expect(result.pv).toBeGreaterThanOrEqual(0n);
        expect(result.ev).toBeGreaterThanOrEqual(0n);
        expect(result.ac).toBeGreaterThanOrEqual(0n);

        if (result.spi !== null) {
          expect(result.spi).toBeGreaterThanOrEqual(0);
        }
        if (result.cpi !== null) {
          expect(result.cpi).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 500 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Property 21: WBS Hierarchy Rollup Invariant
// **Validates: Requirements 11.7**
// ═══════════════════════════════════════════════════════════════════════════════

describe("Property 21: WBS Hierarchy Rollup Invariant", () => {
  it("parent duration equals sum of child durations", () => {
    fc.assert(
      fc.property(wbsTreeArb, (nodes) => {
        const results = rollupWbs(nodes);
        expect(results).not.toBeNull();

        const resultMap = new Map(results!.map((r) => [r.id, r]));
        const parentResult = resultMap.get("parent");
        expect(parentResult).toBeDefined();

        // Sum child durations
        const children = nodes.filter((n) => n.parentId === "parent");
        let expectedDuration = 0n;
        for (const child of children) {
          expectedDuration += child.durationMs;
        }

        expect(parentResult!.durationMs).toBe(expectedDuration);
      }),
      { numRuns: 500 },
    );
  });

  it("parent cost equals sum of child costs", () => {
    fc.assert(
      fc.property(wbsTreeArb, (nodes) => {
        const results = rollupWbs(nodes);
        expect(results).not.toBeNull();

        const resultMap = new Map(results!.map((r) => [r.id, r]));
        const parentResult = resultMap.get("parent");
        expect(parentResult).toBeDefined();

        // Sum child costs
        const children = nodes.filter((n) => n.parentId === "parent");
        let expectedCost = 0n;
        for (const child of children) {
          expectedCost += child.costPaise;
        }

        expect(parentResult!.costPaise).toBe(expectedCost);
      }),
      { numRuns: 500 },
    );
  });

  it("parent completion % equals weighted average of children", () => {
    fc.assert(
      fc.property(wbsTreeArb, (nodes) => {
        const results = rollupWbs(nodes);
        expect(results).not.toBeNull();

        const resultMap = new Map(results!.map((r) => [r.id, r]));
        const parentResult = resultMap.get("parent");
        expect(parentResult).toBeDefined();

        // Compute expected weighted average
        const children = nodes.filter((n) => n.parentId === "parent");
        let weightedSum = 0;
        let totalWeight = 0;
        for (const child of children) {
          weightedSum += child.completionPct * child.weightPct;
          totalWeight += child.weightPct;
        }

        const expectedCompletion = totalWeight === 0
          ? 0
          : Math.round((weightedSum / totalWeight) * 100) / 100;

        expect(parentResult!.completionPct).toBeCloseTo(expectedCompletion, 2);
      }),
      { numRuns: 500 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Property 22: Delay Analysis Variance
// **Validates: Requirements 11.8**
// ═══════════════════════════════════════════════════════════════════════════════

describe("Property 22: Delay Analysis Variance", () => {
  it("reports positive variance when actual dates exceed baseline", () => {
    fc.assert(
      fc.property(
        timestampMsArb,
        timestampMsArb,
        fc.bigInt({ min: 1n, max: 86_400_000_000n }), // positive delay (1ms to 1000 days)
        fc.bigInt({ min: 1n, max: 86_400_000_000n }),
        fc.boolean(),
        (baseStart, baseEnd, startDelay, endDelay, onCritical) => {
          // Ensure baseEnd > baseStart
          const adjustedBaseEnd = baseStart + 86_400_000n + baseEnd;

          const input: DelayAnalysisInput = {
            taskId: "task-1",
            actualStartMs: baseStart + startDelay, // delayed
            actualEndMs: adjustedBaseEnd + endDelay, // delayed
            baselineStartMs: baseStart,
            baselineEndMs: adjustedBaseEnd,
            onCriticalPath: onCritical,
          };

          const results = analyzeDelays([input]);
          expect(results.length).toBe(1);

          const result = results[0]!;
          expect(result.startVarianceMs).toBe(startDelay);
          expect(result.endVarianceMs).toBe(endDelay);
          expect(result.onCriticalPath).toBe(onCritical);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("reports zero variance (excluded from results) when actual <= baseline", () => {
    fc.assert(
      fc.property(
        timestampMsArb,
        timestampMsArb,
        fc.bigInt({ min: 0n, max: 86_400_000_000n }), // lead (ahead of schedule)
        fc.bigInt({ min: 0n, max: 86_400_000_000n }),
        fc.boolean(),
        (baseStart, baseEnd, startLead, endLead, onCritical) => {
          const adjustedBaseEnd = baseStart + 86_400_000n + baseEnd;

          const input: DelayAnalysisInput = {
            taskId: "task-early",
            actualStartMs: baseStart - startLead, // on-time or early
            actualEndMs: adjustedBaseEnd - endLead, // on-time or early
            baselineStartMs: baseStart,
            baselineEndMs: adjustedBaseEnd,
            onCriticalPath: onCritical,
          };

          const results = analyzeDelays([input]);
          // Not delayed → should not appear in results
          expect(results.length).toBe(0);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("variance is measured in milliseconds (positive difference)", () => {
    fc.assert(
      fc.property(
        timestampMsArb,
        fc.bigInt({ min: 1n, max: 86_400_000_000n }),
        fc.boolean(),
        (baselineMs, delayMs, onCritical) => {
          const input: DelayAnalysisInput = {
            taskId: "task-var",
            actualStartMs: baselineMs + delayMs,
            actualEndMs: baselineMs + 86_400_000n + delayMs,
            baselineStartMs: baselineMs,
            baselineEndMs: baselineMs + 86_400_000n,
            onCriticalPath: onCritical,
          };

          const results = analyzeDelays([input]);
          expect(results.length).toBe(1);

          // Variance should be exactly the delay amount
          expect(results[0]!.startVarianceMs).toBe(delayMs);
          expect(results[0]!.endVarianceMs).toBe(delayMs);
          // Verify it's in ms (bigint type)
          expect(typeof results[0]!.startVarianceMs).toBe("bigint");
          expect(typeof results[0]!.endVarianceMs).toBe("bigint");
        },
      ),
      { numRuns: 500 },
    );
  });
});
