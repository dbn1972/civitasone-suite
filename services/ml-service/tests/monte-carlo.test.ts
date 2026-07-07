import { describe, it, expect } from "vitest";
import {
  simulateProjectDelay,
  type TaskSimInput,
} from "../src/modules/algorithms/monte-carlo.js";

describe("Monte Carlo Simulation — simulateProjectDelay", () => {
  describe("edge cases", () => {
    it("returns zeros for empty task array", () => {
      const result = simulateProjectDelay([], 100);
      expect(result.p50Ms).toBe(0n);
      expect(result.p80Ms).toBe(0n);
      expect(result.p95Ms).toBe(0n);
      expect(result.taskRisks).toEqual([]);
      expect(result.bottlenecks).toEqual([]);
    });

    it("handles a single task with zero variance (deterministic)", () => {
      const tasks: TaskSimInput[] = [
        {
          taskId: "A",
          baselineDurationMs: 5000,
          varianceMs: 0,
          dependencies: [],
          isCriticalPath: true,
        },
      ];

      const result = simulateProjectDelay(tasks, 100, 42);

      // Zero variance → all iterations produce exactly 5000ms
      expect(result.p50Ms).toBe(5000n);
      expect(result.p80Ms).toBe(5000n);
      expect(result.p95Ms).toBe(5000n);
      expect(result.taskRisks).toHaveLength(1);
      expect(result.taskRisks[0]!.taskId).toBe("A");
      expect(result.taskRisks[0]!.riskScore).toBe(1.0);
    });

    it("handles a single task with variance", () => {
      const tasks: TaskSimInput[] = [
        {
          taskId: "A",
          baselineDurationMs: 10000,
          varianceMs: 2000,
          dependencies: [],
          isCriticalPath: true,
        },
      ];

      const result = simulateProjectDelay(tasks, 1000, 123);

      // With variance, p50 should be around baseline, p95 should be higher
      expect(result.p50Ms).toBeGreaterThan(0n);
      expect(result.p95Ms).toBeGreaterThanOrEqual(result.p80Ms);
      expect(result.p80Ms).toBeGreaterThanOrEqual(result.p50Ms);
    });

    it("handles disconnected dependency graph (parallel components)", () => {
      const tasks: TaskSimInput[] = [
        {
          taskId: "A",
          baselineDurationMs: 3000,
          varianceMs: 0,
          dependencies: [],
          isCriticalPath: true,
        },
        {
          taskId: "B",
          baselineDurationMs: 7000,
          varianceMs: 0,
          dependencies: [],
          isCriticalPath: true,
        },
      ];

      const result = simulateProjectDelay(tasks, 100, 42);

      // Disconnected → run in parallel → project completion = max(3000, 7000) = 7000
      expect(result.p50Ms).toBe(7000n);
      expect(result.p80Ms).toBe(7000n);
      expect(result.p95Ms).toBe(7000n);
    });

    it("handles tasks with dependencies that do not exist in the task list", () => {
      const tasks: TaskSimInput[] = [
        {
          taskId: "A",
          baselineDurationMs: 5000,
          varianceMs: 0,
          dependencies: ["NONEXISTENT"],
          isCriticalPath: false,
        },
      ];

      const result = simulateProjectDelay(tasks, 100, 42);

      // Non-existent deps are ignored → task runs from time 0
      expect(result.p50Ms).toBe(5000n);
    });
  });

  describe("dependency graph computation", () => {
    it("sequential chain: A → B → C", () => {
      const tasks: TaskSimInput[] = [
        { taskId: "A", baselineDurationMs: 1000, varianceMs: 0, dependencies: [], isCriticalPath: true },
        { taskId: "B", baselineDurationMs: 2000, varianceMs: 0, dependencies: ["A"], isCriticalPath: true },
        { taskId: "C", baselineDurationMs: 3000, varianceMs: 0, dependencies: ["B"], isCriticalPath: true },
      ];

      const result = simulateProjectDelay(tasks, 100, 42);

      // Total = 1000 + 2000 + 3000 = 6000
      expect(result.p50Ms).toBe(6000n);
      expect(result.p80Ms).toBe(6000n);
      expect(result.p95Ms).toBe(6000n);
    });

    it("parallel paths with different lengths", () => {
      // A(1000) → C(1000)
      // B(5000) → C(1000)
      // Critical path: B → C = 6000
      const tasks: TaskSimInput[] = [
        { taskId: "A", baselineDurationMs: 1000, varianceMs: 0, dependencies: [], isCriticalPath: false },
        { taskId: "B", baselineDurationMs: 5000, varianceMs: 0, dependencies: [], isCriticalPath: true },
        { taskId: "C", baselineDurationMs: 1000, varianceMs: 0, dependencies: ["A", "B"], isCriticalPath: true },
      ];

      const result = simulateProjectDelay(tasks, 100, 42);

      // C starts after max(A, B) = max(1000, 5000) = 5000
      // Total = 5000 + 1000 = 6000
      expect(result.p50Ms).toBe(6000n);
    });

    it("diamond dependency pattern", () => {
      //    A(2000)
      //   / \
      //  B(3000) C(1000)
      //   \ /
      //    D(1000)
      const tasks: TaskSimInput[] = [
        { taskId: "A", baselineDurationMs: 2000, varianceMs: 0, dependencies: [], isCriticalPath: true },
        { taskId: "B", baselineDurationMs: 3000, varianceMs: 0, dependencies: ["A"], isCriticalPath: true },
        { taskId: "C", baselineDurationMs: 1000, varianceMs: 0, dependencies: ["A"], isCriticalPath: false },
        { taskId: "D", baselineDurationMs: 1000, varianceMs: 0, dependencies: ["B", "C"], isCriticalPath: true },
      ];

      const result = simulateProjectDelay(tasks, 100, 42);

      // Path A→B→D = 2000+3000+1000 = 6000
      // Path A→C→D = 2000+1000+1000 = 4000
      // Critical path = 6000
      expect(result.p50Ms).toBe(6000n);
    });
  });

  describe("percentile ordering invariant", () => {
    it("p50 ≤ p80 ≤ p95 with high variance tasks", () => {
      const tasks: TaskSimInput[] = [
        { taskId: "A", baselineDurationMs: 10000, varianceMs: 5000, dependencies: [], isCriticalPath: true },
        { taskId: "B", baselineDurationMs: 8000, varianceMs: 4000, dependencies: ["A"], isCriticalPath: true },
        { taskId: "C", baselineDurationMs: 12000, varianceMs: 6000, dependencies: [], isCriticalPath: true },
      ];

      const result = simulateProjectDelay(tasks, 1000, 99);

      expect(result.p50Ms).toBeLessThanOrEqual(result.p80Ms);
      expect(result.p80Ms).toBeLessThanOrEqual(result.p95Ms);
    });

    it("p50 ≤ p80 ≤ p95 for tasks with mixed variance", () => {
      const tasks: TaskSimInput[] = [
        { taskId: "A", baselineDurationMs: 5000, varianceMs: 0, dependencies: [], isCriticalPath: true },
        { taskId: "B", baselineDurationMs: 3000, varianceMs: 1500, dependencies: ["A"], isCriticalPath: true },
        { taskId: "C", baselineDurationMs: 7000, varianceMs: 3000, dependencies: [], isCriticalPath: true },
        { taskId: "D", baselineDurationMs: 2000, varianceMs: 500, dependencies: ["B", "C"], isCriticalPath: true },
      ];

      const result = simulateProjectDelay(tasks, 1000, 77);

      expect(result.p50Ms).toBeLessThanOrEqual(result.p80Ms);
      expect(result.p80Ms).toBeLessThanOrEqual(result.p95Ms);
    });
  });

  describe("task risk scores", () => {
    it("tasks always on critical path get risk score close to 1.0", () => {
      // Single chain: always critical
      const tasks: TaskSimInput[] = [
        { taskId: "A", baselineDurationMs: 5000, varianceMs: 100, dependencies: [], isCriticalPath: true },
        { taskId: "B", baselineDurationMs: 5000, varianceMs: 100, dependencies: ["A"], isCriticalPath: true },
      ];

      const result = simulateProjectDelay(tasks, 500, 42);

      // Both tasks are always on the critical path (single chain)
      const riskA = result.taskRisks.find((r) => r.taskId === "A");
      const riskB = result.taskRisks.find((r) => r.taskId === "B");
      expect(riskA!.riskScore).toBeGreaterThan(0.5);
      expect(riskB!.riskScore).toBe(1.0); // last task in chain is always critical
    });

    it("identifies high variance factor", () => {
      const tasks: TaskSimInput[] = [
        {
          taskId: "A",
          baselineDurationMs: 1000,
          varianceMs: 600, // > 50% of baseline
          dependencies: [],
          isCriticalPath: true,
        },
      ];

      const result = simulateProjectDelay(tasks, 100, 42);
      const riskA = result.taskRisks.find((r) => r.taskId === "A");
      expect(riskA!.factors).toContain("high variance");
    });

    it("identifies heavy dependency chain factor", () => {
      const tasks: TaskSimInput[] = [
        { taskId: "A", baselineDurationMs: 1000, varianceMs: 0, dependencies: [], isCriticalPath: true },
        { taskId: "B", baselineDurationMs: 1000, varianceMs: 0, dependencies: [], isCriticalPath: true },
        { taskId: "C", baselineDurationMs: 1000, varianceMs: 0, dependencies: [], isCriticalPath: true },
        {
          taskId: "D",
          baselineDurationMs: 1000,
          varianceMs: 0,
          dependencies: ["A", "B", "C"],
          isCriticalPath: true,
        },
      ];

      const result = simulateProjectDelay(tasks, 100, 42);
      const riskD = result.taskRisks.find((r) => r.taskId === "D");
      expect(riskD!.factors).toContain("heavy dependency chain");
    });
  });

  describe("resource bottlenecks", () => {
    it("detects bottleneck when user has > 3 critical path tasks", () => {
      const tasks: TaskSimInput[] = [
        { taskId: "A", baselineDurationMs: 1000, varianceMs: 0, dependencies: [], assignedTo: "user-1", isCriticalPath: true },
        { taskId: "B", baselineDurationMs: 1000, varianceMs: 0, dependencies: [], assignedTo: "user-1", isCriticalPath: true },
        { taskId: "C", baselineDurationMs: 1000, varianceMs: 0, dependencies: [], assignedTo: "user-1", isCriticalPath: true },
        { taskId: "D", baselineDurationMs: 1000, varianceMs: 0, dependencies: [], assignedTo: "user-1", isCriticalPath: true },
      ];

      const result = simulateProjectDelay(tasks, 100, 42);

      expect(result.bottlenecks).toHaveLength(1);
      expect(result.bottlenecks[0]!.userId).toBe("user-1");
      expect(result.bottlenecks[0]!.concurrentCriticalTasks).toBe(4);
    });

    it("does not flag user with exactly 3 critical path tasks", () => {
      const tasks: TaskSimInput[] = [
        { taskId: "A", baselineDurationMs: 1000, varianceMs: 0, dependencies: [], assignedTo: "user-1", isCriticalPath: true },
        { taskId: "B", baselineDurationMs: 1000, varianceMs: 0, dependencies: [], assignedTo: "user-1", isCriticalPath: true },
        { taskId: "C", baselineDurationMs: 1000, varianceMs: 0, dependencies: [], assignedTo: "user-1", isCriticalPath: true },
      ];

      const result = simulateProjectDelay(tasks, 100, 42);
      expect(result.bottlenecks).toHaveLength(0);
    });

    it("does not count non-critical-path tasks for bottleneck detection", () => {
      const tasks: TaskSimInput[] = [
        { taskId: "A", baselineDurationMs: 1000, varianceMs: 0, dependencies: [], assignedTo: "user-1", isCriticalPath: true },
        { taskId: "B", baselineDurationMs: 1000, varianceMs: 0, dependencies: [], assignedTo: "user-1", isCriticalPath: true },
        { taskId: "C", baselineDurationMs: 1000, varianceMs: 0, dependencies: [], assignedTo: "user-1", isCriticalPath: false },
        { taskId: "D", baselineDurationMs: 1000, varianceMs: 0, dependencies: [], assignedTo: "user-1", isCriticalPath: false },
      ];

      const result = simulateProjectDelay(tasks, 100, 42);
      expect(result.bottlenecks).toHaveLength(0);
    });

    it("detects multiple bottlenecks from different users", () => {
      const tasks: TaskSimInput[] = [
        { taskId: "A", baselineDurationMs: 1000, varianceMs: 0, dependencies: [], assignedTo: "user-1", isCriticalPath: true },
        { taskId: "B", baselineDurationMs: 1000, varianceMs: 0, dependencies: [], assignedTo: "user-1", isCriticalPath: true },
        { taskId: "C", baselineDurationMs: 1000, varianceMs: 0, dependencies: [], assignedTo: "user-1", isCriticalPath: true },
        { taskId: "D", baselineDurationMs: 1000, varianceMs: 0, dependencies: [], assignedTo: "user-1", isCriticalPath: true },
        { taskId: "E", baselineDurationMs: 1000, varianceMs: 0, dependencies: [], assignedTo: "user-2", isCriticalPath: true },
        { taskId: "F", baselineDurationMs: 1000, varianceMs: 0, dependencies: [], assignedTo: "user-2", isCriticalPath: true },
        { taskId: "G", baselineDurationMs: 1000, varianceMs: 0, dependencies: [], assignedTo: "user-2", isCriticalPath: true },
        { taskId: "H", baselineDurationMs: 1000, varianceMs: 0, dependencies: [], assignedTo: "user-2", isCriticalPath: true },
        { taskId: "I", baselineDurationMs: 1000, varianceMs: 0, dependencies: [], assignedTo: "user-2", isCriticalPath: true },
      ];

      const result = simulateProjectDelay(tasks, 100, 42);
      expect(result.bottlenecks).toHaveLength(2);
      // Sorted by count descending
      expect(result.bottlenecks[0]!.userId).toBe("user-2");
      expect(result.bottlenecks[0]!.concurrentCriticalTasks).toBe(5);
      expect(result.bottlenecks[1]!.userId).toBe("user-1");
      expect(result.bottlenecks[1]!.concurrentCriticalTasks).toBe(4);
    });
  });

  describe("seeded PRNG reproducibility", () => {
    it("produces identical results with the same seed", () => {
      const tasks: TaskSimInput[] = [
        { taskId: "A", baselineDurationMs: 10000, varianceMs: 3000, dependencies: [], isCriticalPath: true },
        { taskId: "B", baselineDurationMs: 8000, varianceMs: 2000, dependencies: ["A"], isCriticalPath: true },
      ];

      const result1 = simulateProjectDelay(tasks, 500, 12345);
      const result2 = simulateProjectDelay(tasks, 500, 12345);

      expect(result1.p50Ms).toBe(result2.p50Ms);
      expect(result1.p80Ms).toBe(result2.p80Ms);
      expect(result1.p95Ms).toBe(result2.p95Ms);
    });

    it("produces different results with different seeds", () => {
      const tasks: TaskSimInput[] = [
        { taskId: "A", baselineDurationMs: 10000, varianceMs: 3000, dependencies: [], isCriticalPath: true },
        { taskId: "B", baselineDurationMs: 8000, varianceMs: 2000, dependencies: ["A"], isCriticalPath: true },
      ];

      const result1 = simulateProjectDelay(tasks, 500, 42);
      const result2 = simulateProjectDelay(tasks, 500, 99);

      // Very unlikely to be identical with different seeds and variance
      const sameP50 = result1.p50Ms === result2.p50Ms;
      const sameP80 = result1.p80Ms === result2.p80Ms;
      const sameP95 = result1.p95Ms === result2.p95Ms;
      expect(sameP50 && sameP80 && sameP95).toBe(false);
    });
  });

  describe("statistical properties", () => {
    it("zero-variance tasks produce consistent percentiles equal to deterministic path", () => {
      const tasks: TaskSimInput[] = [
        { taskId: "A", baselineDurationMs: 4000, varianceMs: 0, dependencies: [], isCriticalPath: true },
        { taskId: "B", baselineDurationMs: 6000, varianceMs: 0, dependencies: ["A"], isCriticalPath: true },
      ];

      const result = simulateProjectDelay(tasks, 500, 42);

      // Deterministic: 4000 + 6000 = 10000
      expect(result.p50Ms).toBe(10000n);
      expect(result.p80Ms).toBe(10000n);
      expect(result.p95Ms).toBe(10000n);
    });

    it("higher variance leads to wider spread between p50 and p95", () => {
      const tasksLowVar: TaskSimInput[] = [
        { taskId: "A", baselineDurationMs: 10000, varianceMs: 100, dependencies: [], isCriticalPath: true },
      ];

      const tasksHighVar: TaskSimInput[] = [
        { taskId: "A", baselineDurationMs: 10000, varianceMs: 5000, dependencies: [], isCriticalPath: true },
      ];

      const resultLow = simulateProjectDelay(tasksLowVar, 1000, 42);
      const resultHigh = simulateProjectDelay(tasksHighVar, 1000, 42);

      const spreadLow = resultLow.p95Ms - resultLow.p50Ms;
      const spreadHigh = resultHigh.p95Ms - resultHigh.p50Ms;

      expect(spreadHigh).toBeGreaterThan(spreadLow);
    });
  });
});
