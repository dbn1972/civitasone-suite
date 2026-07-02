import { describe, it, expect } from "vitest";
import {
  resolveReadySteps,
  isWizardComplete,
  getWizardProgress,
  detectCircularDependencies,
  computeInitialStatus,
  type StepDef,
  type StepExec,
} from "../src/modules/orchestrator/domain.js";

// ══════════════════════════════════════════════════════════════════════════════
// resolveReadySteps
// ══════════════════════════════════════════════════════════════════════════════
describe("resolveReadySteps", () => {
  it("returns steps with no dependencies as ready", () => {
    const defs: StepDef[] = [
      { stepKey: "a", isRequired: true, dependsOn: [] },
      { stepKey: "b", isRequired: true, dependsOn: ["a"] },
    ];
    const execs: StepExec[] = [
      { stepKey: "a", status: "pending" },
      { stepKey: "b", status: "blocked" },
    ];
    expect(resolveReadySteps(defs, execs)).toEqual(["a"]);
  });

  it("unblocks step when dependency is completed", () => {
    const defs: StepDef[] = [
      { stepKey: "a", isRequired: true, dependsOn: [] },
      { stepKey: "b", isRequired: true, dependsOn: ["a"] },
    ];
    const execs: StepExec[] = [
      { stepKey: "a", status: "completed" },
      { stepKey: "b", status: "blocked" },
    ];
    expect(resolveReadySteps(defs, execs)).toEqual(["b"]);
  });

  it("unblocks step when dependency is skipped", () => {
    const defs: StepDef[] = [
      { stepKey: "a", isRequired: false, dependsOn: [] },
      { stepKey: "b", isRequired: true, dependsOn: ["a"] },
    ];
    const execs: StepExec[] = [
      { stepKey: "a", status: "skipped" },
      { stepKey: "b", status: "pending" },
    ];
    expect(resolveReadySteps(defs, execs)).toEqual(["b"]);
  });

  it("does not unblock when dependency is in_progress", () => {
    const defs: StepDef[] = [
      { stepKey: "a", isRequired: true, dependsOn: [] },
      { stepKey: "b", isRequired: true, dependsOn: ["a"] },
    ];
    const execs: StepExec[] = [
      { stepKey: "a", status: "in_progress" },
      { stepKey: "b", status: "blocked" },
    ];
    expect(resolveReadySteps(defs, execs)).toEqual([]);
  });

  it("does not include already completed steps", () => {
    const defs: StepDef[] = [
      { stepKey: "a", isRequired: true, dependsOn: [] },
      { stepKey: "b", isRequired: true, dependsOn: ["a"] },
    ];
    const execs: StepExec[] = [
      { stepKey: "a", status: "completed" },
      { stepKey: "b", status: "completed" },
    ];
    expect(resolveReadySteps(defs, execs)).toEqual([]);
  });

  it("does not include in_progress steps", () => {
    const defs: StepDef[] = [
      { stepKey: "a", isRequired: true, dependsOn: [] },
    ];
    const execs: StepExec[] = [
      { stepKey: "a", status: "in_progress" },
    ];
    expect(resolveReadySteps(defs, execs)).toEqual([]);
  });

  it("handles multiple dependencies", () => {
    const defs: StepDef[] = [
      { stepKey: "a", isRequired: true, dependsOn: [] },
      { stepKey: "b", isRequired: true, dependsOn: [] },
      { stepKey: "c", isRequired: true, dependsOn: ["a", "b"] },
    ];
    const execs: StepExec[] = [
      { stepKey: "a", status: "completed" },
      { stepKey: "b", status: "pending" },
      { stepKey: "c", status: "blocked" },
    ];
    // c can't be ready because b is not completed
    expect(resolveReadySteps(defs, execs)).toEqual(["b"]);
  });

  it("unblocks multiple steps simultaneously", () => {
    const defs: StepDef[] = [
      { stepKey: "a", isRequired: true, dependsOn: [] },
      { stepKey: "b", isRequired: true, dependsOn: ["a"] },
      { stepKey: "c", isRequired: true, dependsOn: ["a"] },
    ];
    const execs: StepExec[] = [
      { stepKey: "a", status: "completed" },
      { stepKey: "b", status: "blocked" },
      { stepKey: "c", status: "blocked" },
    ];
    expect(resolveReadySteps(defs, execs)).toEqual(["b", "c"]);
  });

  it("returns empty when no executions exist for a step", () => {
    const defs: StepDef[] = [
      { stepKey: "a", isRequired: true, dependsOn: [] },
    ];
    const execs: StepExec[] = [];
    expect(resolveReadySteps(defs, execs)).toEqual([]);
  });

  it("does not include failed steps", () => {
    const defs: StepDef[] = [
      { stepKey: "a", isRequired: true, dependsOn: [] },
    ];
    const execs: StepExec[] = [
      { stepKey: "a", status: "failed" },
    ];
    expect(resolveReadySteps(defs, execs)).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// isWizardComplete
// ══════════════════════════════════════════════════════════════════════════════
describe("isWizardComplete", () => {
  it("returns true when all required steps completed", () => {
    const defs: StepDef[] = [
      { stepKey: "a", isRequired: true, dependsOn: [] },
      { stepKey: "b", isRequired: true, dependsOn: [] },
    ];
    const execs: StepExec[] = [
      { stepKey: "a", status: "completed" },
      { stepKey: "b", status: "completed" },
    ];
    expect(isWizardComplete(defs, execs)).toBe(true);
  });

  it("returns true when required steps are completed or skipped", () => {
    const defs: StepDef[] = [
      { stepKey: "a", isRequired: true, dependsOn: [] },
      { stepKey: "b", isRequired: true, dependsOn: [] },
    ];
    const execs: StepExec[] = [
      { stepKey: "a", status: "completed" },
      { stepKey: "b", status: "skipped" },
    ];
    expect(isWizardComplete(defs, execs)).toBe(true);
  });

  it("returns false when required step is pending", () => {
    const defs: StepDef[] = [
      { stepKey: "a", isRequired: true, dependsOn: [] },
      { stepKey: "b", isRequired: true, dependsOn: [] },
    ];
    const execs: StepExec[] = [
      { stepKey: "a", status: "completed" },
      { stepKey: "b", status: "pending" },
    ];
    expect(isWizardComplete(defs, execs)).toBe(false);
  });

  it("returns false when required step is in_progress", () => {
    const defs: StepDef[] = [
      { stepKey: "a", isRequired: true, dependsOn: [] },
    ];
    const execs: StepExec[] = [
      { stepKey: "a", status: "in_progress" },
    ];
    expect(isWizardComplete(defs, execs)).toBe(false);
  });

  it("returns true when optional step is not completed", () => {
    const defs: StepDef[] = [
      { stepKey: "a", isRequired: true, dependsOn: [] },
      { stepKey: "b", isRequired: false, dependsOn: [] },
    ];
    const execs: StepExec[] = [
      { stepKey: "a", status: "completed" },
      { stepKey: "b", status: "pending" },
    ];
    expect(isWizardComplete(defs, execs)).toBe(true);
  });

  it("returns true for empty definitions", () => {
    expect(isWizardComplete([], [])).toBe(true);
  });

  it("returns false when required step has no execution", () => {
    const defs: StepDef[] = [
      { stepKey: "a", isRequired: true, dependsOn: [] },
    ];
    const execs: StepExec[] = [];
    expect(isWizardComplete(defs, execs)).toBe(false);
  });

  it("returns false when required step is blocked", () => {
    const defs: StepDef[] = [
      { stepKey: "a", isRequired: true, dependsOn: ["b"] },
    ];
    const execs: StepExec[] = [
      { stepKey: "a", status: "blocked" },
    ];
    expect(isWizardComplete(defs, execs)).toBe(false);
  });

  it("returns false when required step is failed", () => {
    const defs: StepDef[] = [
      { stepKey: "a", isRequired: true, dependsOn: [] },
    ];
    const execs: StepExec[] = [
      { stepKey: "a", status: "failed" },
    ];
    expect(isWizardComplete(defs, execs)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// getWizardProgress
// ══════════════════════════════════════════════════════════════════════════════
describe("getWizardProgress", () => {
  it("returns 0% for no progress", () => {
    const defs: StepDef[] = [
      { stepKey: "a", isRequired: true, dependsOn: [] },
      { stepKey: "b", isRequired: true, dependsOn: [] },
    ];
    const execs: StepExec[] = [
      { stepKey: "a", status: "pending" },
      { stepKey: "b", status: "pending" },
    ];
    const result = getWizardProgress(defs, execs);
    expect(result.total).toBe(2);
    expect(result.completed).toBe(0);
    expect(result.percentage).toBe(0);
  });

  it("returns 50% for half completed", () => {
    const defs: StepDef[] = [
      { stepKey: "a", isRequired: true, dependsOn: [] },
      { stepKey: "b", isRequired: true, dependsOn: [] },
    ];
    const execs: StepExec[] = [
      { stepKey: "a", status: "completed" },
      { stepKey: "b", status: "pending" },
    ];
    const result = getWizardProgress(defs, execs);
    expect(result.total).toBe(2);
    expect(result.completed).toBe(1);
    expect(result.percentage).toBe(50);
  });

  it("returns 100% when all done", () => {
    const defs: StepDef[] = [
      { stepKey: "a", isRequired: true, dependsOn: [] },
      { stepKey: "b", isRequired: true, dependsOn: [] },
    ];
    const execs: StepExec[] = [
      { stepKey: "a", status: "completed" },
      { stepKey: "b", status: "completed" },
    ];
    const result = getWizardProgress(defs, execs);
    expect(result.percentage).toBe(100);
  });

  it("counts skipped as completed", () => {
    const defs: StepDef[] = [
      { stepKey: "a", isRequired: true, dependsOn: [] },
      { stepKey: "b", isRequired: false, dependsOn: [] },
    ];
    const execs: StepExec[] = [
      { stepKey: "a", status: "completed" },
      { stepKey: "b", status: "skipped" },
    ];
    const result = getWizardProgress(defs, execs);
    expect(result.completed).toBe(2);
    expect(result.percentage).toBe(100);
  });

  it("returns 100% for empty definitions", () => {
    const result = getWizardProgress([], []);
    expect(result.percentage).toBe(100);
    expect(result.total).toBe(0);
    expect(result.completed).toBe(0);
  });

  it("rounds percentage", () => {
    const defs: StepDef[] = [
      { stepKey: "a", isRequired: true, dependsOn: [] },
      { stepKey: "b", isRequired: true, dependsOn: [] },
      { stepKey: "c", isRequired: true, dependsOn: [] },
    ];
    const execs: StepExec[] = [
      { stepKey: "a", status: "completed" },
      { stepKey: "b", status: "pending" },
      { stepKey: "c", status: "pending" },
    ];
    const result = getWizardProgress(defs, execs);
    expect(result.percentage).toBe(33); // Math.round(1/3 * 100)
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// detectCircularDependencies
// ══════════════════════════════════════════════════════════════════════════════
describe("detectCircularDependencies", () => {
  it("returns empty array for no cycles", () => {
    const defs: StepDef[] = [
      { stepKey: "a", isRequired: true, dependsOn: [] },
      { stepKey: "b", isRequired: true, dependsOn: ["a"] },
      { stepKey: "c", isRequired: true, dependsOn: ["b"] },
    ];
    expect(detectCircularDependencies(defs)).toEqual([]);
  });

  it("detects simple 2-node cycle", () => {
    const defs: StepDef[] = [
      { stepKey: "a", isRequired: true, dependsOn: ["b"] },
      { stepKey: "b", isRequired: true, dependsOn: ["a"] },
    ];
    const result = detectCircularDependencies(defs);
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain("a");
    expect(result).toContain("b");
  });

  it("detects self-cycle", () => {
    const defs: StepDef[] = [
      { stepKey: "a", isRequired: true, dependsOn: ["a"] },
    ];
    const result = detectCircularDependencies(defs);
    expect(result).toContain("a");
  });

  it("detects 3-node cycle", () => {
    const defs: StepDef[] = [
      { stepKey: "a", isRequired: true, dependsOn: ["c"] },
      { stepKey: "b", isRequired: true, dependsOn: ["a"] },
      { stepKey: "c", isRequired: true, dependsOn: ["b"] },
    ];
    const result = detectCircularDependencies(defs);
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns empty for empty definitions", () => {
    expect(detectCircularDependencies([])).toEqual([]);
  });

  it("returns empty for single step with no deps", () => {
    const defs: StepDef[] = [
      { stepKey: "a", isRequired: true, dependsOn: [] },
    ];
    expect(detectCircularDependencies(defs)).toEqual([]);
  });

  it("only marks cycle nodes, not innocent nodes", () => {
    const defs: StepDef[] = [
      { stepKey: "a", isRequired: true, dependsOn: [] },
      { stepKey: "b", isRequired: true, dependsOn: ["c"] },
      { stepKey: "c", isRequired: true, dependsOn: ["b"] },
    ];
    const result = detectCircularDependencies(defs);
    expect(result).not.toContain("a");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// computeInitialStatus
// ══════════════════════════════════════════════════════════════════════════════
describe("computeInitialStatus", () => {
  it("returns ready for step with no dependencies", () => {
    expect(computeInitialStatus({ stepKey: "a", isRequired: true, dependsOn: [] })).toBe("ready");
  });

  it("returns blocked for step with dependencies", () => {
    expect(computeInitialStatus({ stepKey: "b", isRequired: true, dependsOn: ["a"] })).toBe("blocked");
  });

  it("returns blocked for step with multiple dependencies", () => {
    expect(computeInitialStatus({ stepKey: "c", isRequired: true, dependsOn: ["a", "b"] })).toBe("blocked");
  });

  it("returns ready regardless of isRequired", () => {
    expect(computeInitialStatus({ stepKey: "a", isRequired: false, dependsOn: [] })).toBe("ready");
  });
});
