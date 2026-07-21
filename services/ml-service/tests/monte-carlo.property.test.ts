/**
 * Property-Based Test for Monte Carlo Simulation (Project Delay Prediction).
 * Uses fast-check to verify invariants hold across all valid inputs.
 *
 * Property 7: Monte Carlo Percentile Ordering
 * **Validates: Requirements 10.2**
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  simulateProjectDelay,
  type TaskSimInput,
} from "../src/modules/algorithms/monte-carlo.js";

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** A single task: baseline duration 0–50,000ms, variance 0–25,000ms, no dependencies. */
const taskArb: fc.Arbitrary<Omit<TaskSimInput, "taskId" | "dependencies">> = fc.record({
  baselineDurationMs: fc.integer({ min: 0, max: 50_000 }),
  varianceMs: fc.integer({ min: 0, max: 25_000 }),
  isCriticalPath: fc.boolean(),
});

/**
 * An array of 1–15 tasks with varied durations. Dependencies are built as a
 * simple chain to earlier tasks (or none) so the dependency graph is always
 * a DAG — this keeps the generator focused on duration/variance variety
 * (the property under test) without needing to also fuzz graph topology.
 */
const taskArrayArb: fc.Arbitrary<TaskSimInput[]> = fc
  .array(taskArb, { minLength: 1, maxLength: 15 })
  .chain((partials) =>
    fc
      .array(fc.boolean(), { minLength: partials.length, maxLength: partials.length })
      .map((dependsOnPrev) =>
        partials.map((partial, i) => ({
          ...partial,
          taskId: `task-${i}`,
          dependencies: i > 0 && dependsOnPrev[i] ? [`task-${i - 1}`] : [],
        })),
      ),
  );

// ─── Property 7: Monte Carlo Percentile Ordering ──────────────────────────────

describe("Property 7: Monte Carlo Percentile Ordering", () => {
  /**
   * For any array of tasks with varied baseline durations and variances,
   * running the Monte Carlo simulation must always produce percentiles
   * satisfying p50Ms <= p80Ms <= p95Ms. This must hold regardless of
   * variance (including zero-variance/deterministic tasks), dependency
   * chains, or task count.
   *
   * **Validates: Requirements 10.2**
   */
  it("p50Ms <= p80Ms <= p95Ms always holds", () => {
    fc.assert(
      fc.property(
        taskArrayArb,
        fc.integer({ min: 1, max: 500 }), // iterations kept small for test speed
        fc.integer({ min: 0, max: 2 ** 31 - 1 }), // seed for reproducibility
        (tasks, iterations, seed) => {
          const result = simulateProjectDelay(tasks, iterations, seed);

          expect(result.p50Ms).toBeLessThanOrEqual(result.p80Ms);
          expect(result.p80Ms).toBeLessThanOrEqual(result.p95Ms);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * The invariant must also hold for the empty task array edge case,
   * where all percentiles collapse to zero.
   *
   * **Validates: Requirements 10.2**
   */
  it("holds for the empty task array edge case (all percentiles are 0n)", () => {
    const result = simulateProjectDelay([], 100, 42);
    expect(result.p50Ms).toBe(0n);
    expect(result.p80Ms).toBe(0n);
    expect(result.p95Ms).toBe(0n);
    expect(result.p50Ms).toBeLessThanOrEqual(result.p80Ms);
    expect(result.p80Ms).toBeLessThanOrEqual(result.p95Ms);
  });
});
