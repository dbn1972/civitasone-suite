import { describe, it, expect } from "vitest";
import {
  WIZARD_STEPS,
  REQUIRED_STEP_KEYS,
  countComplete,
  progressPct,
  allRequiredComplete,
  firstIncompleteIndex,
  type StepStatus,
  type WizardStepKey,
} from "./setupSteps";

const ALL_KEYS = WIZARD_STEPS.map((s) => s.key);

describe("wizard step model (R7.4, R13.3)", () => {
  it("covers all eight required setup areas in order", () => {
    expect(ALL_KEYS).toEqual([
      "org-profile", "branches", "departments", "people",
      "modules", "finance-year-coa", "leave-policies", "pay-structure",
    ]);
    WIZARD_STEPS.forEach((s, i) => expect(s.num).toBe(i + 1));
  });

  it("gives every step plain title, explanation, example, and an entry href", () => {
    for (const s of WIZARD_STEPS) {
      expect(s.title.trim().length).toBeGreaterThan(0);
      expect(s.explanation.trim().length).toBeGreaterThan(0);
      expect(s.example.trim().length).toBeGreaterThan(0); // R7.8
      expect(s.entryHref.startsWith("/")).toBe(true); // R7.3
    }
  });

  it("tags module-dependent steps with a moduleKey", () => {
    const byKey = Object.fromEntries(WIZARD_STEPS.map((s) => [s.key, s]));
    expect(byKey["finance-year-coa"].moduleKey).toBe("finance");
    expect(byKey["leave-policies"].moduleKey).toBe("hrms");
    expect(byKey["pay-structure"].moduleKey).toBe("hrms");
  });
});

describe("honest progress (R8.2, R8.5, R7.7, R9.2)", () => {
  const make = (overrides: Partial<Record<WizardStepKey, StepStatus>>): Record<string, StepStatus> => {
    const base: Record<string, StepStatus> = {};
    for (const k of ALL_KEYS) base[k] = "todo";
    return { ...base, ...overrides };
  };

  it("counts only complete steps", () => {
    const s = make({ "org-profile": "complete", branches: "unknown", departments: "complete" });
    expect(countComplete(s, ALL_KEYS)).toBe(2);
  });

  it("computes percentage from completed steps only", () => {
    const s = make({ "org-profile": "complete", branches: "complete" });
    expect(progressPct(s, ALL_KEYS)).toBe(Math.round((2 / 8) * 100));
  });

  it("treats unknown as not complete", () => {
    const s = make({ "org-profile": "unknown" });
    expect(countComplete(s, ["org-profile"])).toBe(0);
  });

  it("reaches readiness only when all required steps complete", () => {
    const partial = make({ "org-profile": "complete" });
    expect(allRequiredComplete(partial)).toBe(false);
    const done = make(Object.fromEntries(REQUIRED_STEP_KEYS.map((k) => [k, "complete"])) as Record<WizardStepKey, StepStatus>);
    expect(allRequiredComplete(done)).toBe(true);
  });

  it("resumes at the first non-complete step", () => {
    const s = make({ "org-profile": "complete", branches: "complete" });
    expect(firstIncompleteIndex(WIZARD_STEPS, s)).toBe(2); // departments
  });

  it("includes org-profile and departments as measurable steps", () => {
    expect(REQUIRED_STEP_KEYS).toContain("org-profile");
    expect(REQUIRED_STEP_KEYS).toContain("departments");
  });
});
