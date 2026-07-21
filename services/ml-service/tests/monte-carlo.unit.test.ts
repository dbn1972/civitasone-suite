import { describe, it, expect } from "vitest";
import {
  simulateProjectDelay,
  type TaskSimInput,
} from "../src/modules/algorithms/monte-carlo.js";

/**
 * Additional unit tests for task 3.8 — large dependency chain coverage.
 * Complements tests/monte-carlo.test.ts (which covers empty/single-task/
 * disconnected-graph/seeded-reproducibility cases).
 */
describe("Monte Carlo Simulation — large dependency chains", () => {
  it("computes correct completion time for a long sequential chain (50 tasks)", () => {
    const chainLength = 50;
    const perTaskDuration = 1000;
    const tasks: TaskSimInput[] = Array.from({ length: chainLength }, (_, i) => ({
      taskId: `T${i}`,
      baselineDurationMs: perTaskDuration,
      varianceMs: 0,
      dependencies: i === 0 ? [] : [`T${i - 1}`],
      isCriticalPath: true,
    }));

    const result = simulateProjectDelay(tasks, 200, 7);

    // Deterministic zero-variance chain: total = chainLength * perTaskDuration
    const expectedTotal = BigInt(chainLength * perTaskDuration);
    expect(result.p50Ms).toBe(expectedTotal);
    expect(result.p80Ms).toBe(expectedTotal);
    expect(result.p95Ms).toBe(expectedTotal);

    // Every task in a single unbranched chain sits on the critical path
    expect(result.taskRisks).toHaveLength(chainLength);
    for (const risk of result.taskRisks) {
      expect(risk.riskScore).toBeGreaterThan(0);
    }
  });

  it("handles a wide fan-out/fan-in graph with many parallel branches", () => {
    // 1 root -> 30 parallel branches of varying length -> 1 sink
    const branchCount = 30;
    const tasks: TaskSimInput[] = [
      { taskId: "root", baselineDurationMs: 500, varianceMs: 0, dependencies: [], isCriticalPath: true },
    ];

    for (let b = 0; b < branchCount; b++) {
      tasks.push({
        taskId: `branch-${b}`,
        baselineDurationMs: 1000 + b * 100, // longest branch: b=29 -> 3900ms
        varianceMs: 0,
        dependencies: ["root"],
        isCriticalPath: b === branchCount - 1,
      });
    }

    tasks.push({
      taskId: "sink",
      baselineDurationMs: 200,
      varianceMs: 0,
      dependencies: tasks.filter((t) => t.taskId.startsWith("branch-")).map((t) => t.taskId),
      isCriticalPath: true,
    });

    const result = simulateProjectDelay(tasks, 100, 11);

    // Critical path = root(500) + longest branch(3900) + sink(200) = 4600
    const expectedTotal = 500n + 3900n + 200n;
    expect(result.p50Ms).toBe(expectedTotal);
    expect(result.p80Ms).toBe(expectedTotal);
    expect(result.p95Ms).toBe(expectedTotal);
    expect(result.taskRisks).toHaveLength(tasks.length);
  });

  it("maintains p50 <= p80 <= p95 invariant on a large chain with variance", () => {
    const chainLength = 40;
    const tasks: TaskSimInput[] = Array.from({ length: chainLength }, (_, i) => ({
      taskId: `T${i}`,
      baselineDurationMs: 500 + (i % 5) * 100,
      varianceMs: 50 + (i % 3) * 40,
      dependencies: i === 0 ? [] : [`T${i - 1}`],
      isCriticalPath: true,
    }));

    const result = simulateProjectDelay(tasks, 500, 2024);

    expect(result.p50Ms).toBeLessThanOrEqual(result.p80Ms);
    expect(result.p80Ms).toBeLessThanOrEqual(result.p95Ms);
    expect(result.taskRisks).toHaveLength(chainLength);
  });

  it("completes within a reasonable time for a large graph with many iterations", () => {
    const chainLength = 100;
    const tasks: TaskSimInput[] = Array.from({ length: chainLength }, (_, i) => ({
      taskId: `T${i}`,
      baselineDurationMs: 100,
      varianceMs: 10,
      dependencies: i === 0 ? [] : [`T${i - 1}`],
      isCriticalPath: true,
    }));

    const start = Date.now();
    const result = simulateProjectDelay(tasks, 1000, 5);
    const elapsedMs = Date.now() - start;

    expect(result.taskRisks).toHaveLength(chainLength);
    expect(elapsedMs).toBeLessThan(10_000);
  });
});
