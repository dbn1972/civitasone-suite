import { describe, it, expect } from "vitest";
import { stageToStep } from "../src/modules/stages/routes.js";

// GAP-TENANT-ADMIN-INSTALL-05: pins the finding that install "steps" are a 1:1
// view over install "stages" (same resource, one granularity), so a step's
// status is derived purely from its stage's status and can never be a
// divergent rollup. Given 2 of 5 stages complete, the steps view reports the
// same 2 completed — no aggregation.
describe("GAP-TENANT-ADMIN-INSTALL-05 — steps are a 1:1 view of stages", () => {
  const stages = [
    { id: "s1", stepNumber: 1, name: "Deployment mode", description: "pick host", status: "completed" },
    { id: "s2", stepNumber: 2, name: "Database", description: null, status: "completed" },
    { id: "s3", stepNumber: 3, name: "Domain pack", description: undefined as unknown as string, status: "in_progress" },
    { id: "s4", stepNumber: 4, name: "Modules", status: "pending" },
    { id: "s5", stepNumber: 5, name: "Finish", status: "skipped" },
  ];

  it("maps each stage to exactly one step, preserving status 1:1", () => {
    const steps = stages.map(stageToStep);
    expect(steps).toHaveLength(stages.length);
    expect(steps.map((s) => s.stepNo)).toEqual([1, 2, 3, 4, 5]);
    expect(steps.map((s) => s.status)).toEqual([
      "completed",
      "completed",
      "in_progress",
      "pending",
      "skipped",
    ]);
    // completed count on the steps view equals completed stages (no rollup)
    const completedSteps = steps.filter((s) => s.status === "completed").length;
    const completedStages = stages.filter((s) => s.status === "completed").length;
    expect(completedSteps).toBe(completedStages);
    expect(completedSteps).toBe(2);
  });

  it("normalises unknown stage status to 'pending' (never fabricates completion)", () => {
    expect(stageToStep({ id: "x", stepNumber: 1, name: "n", status: "weird" }).status).toBe("pending");
  });

  it("passes description through, coercing null to undefined", () => {
    expect(stageToStep({ id: "x", stepNumber: 1, name: "n", description: null, status: "pending" }).description).toBeUndefined();
    expect(stageToStep({ id: "x", stepNumber: 1, name: "n", description: "d", status: "pending" }).description).toBe("d");
  });
});
