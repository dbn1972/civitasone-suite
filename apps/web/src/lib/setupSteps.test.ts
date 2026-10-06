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

  it("scopes the required departments step to the HRMS module (GAP-SETUP-HOME-01)", () => {
    const departments = WIZARD_STEPS.find((s) => s.key === "departments")!;
    expect(departments.required).toBe(true);
    expect(departments.moduleKey).toBe("hrms");
    // Points at the real departments management screen, not the people directory.
    expect(departments.entryHref).toBe("/hr/departments");
  });

  it("gives steps 1 and 5 distinct destinations (GAP-SETUP-HOME-04)", () => {
    const byKey = Object.fromEntries(WIZARD_STEPS.map((s) => [s.key, s]));
    const orgHref = byKey["org-profile"].entryHref;
    const modHref = byKey["modules"].entryHref;
    expect(orgHref).not.toBe(modHref);
    expect(modHref).toContain("#modules");
  });

  it("words the branches step to match a single-head-office completion rule (GAP-SETUP-HOME-03)", () => {
    const branches = WIZARD_STEPS.find((s) => s.key === "branches")!;
    expect(branches.title.toLowerCase()).toContain("head office");
    expect(branches.title.toLowerCase()).not.toContain("branch offices");
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

  it("ignores hidden module-scoped required steps for readiness (GAP-SETUP-HOME-01)", () => {
    // Tenant with HR off: the departments step is filtered out upstream, so the
    // visible required steps exclude it. Completing the remaining required steps
    // must make the office 'ready' even though departments is never complete.
    const visible = WIZARD_STEPS.filter((s) => s.moduleKey !== "hrms");
    const requiredVisibleKeys = visible.filter((s) => s.required).map((s) => s.key);
    const statuses = make(
      Object.fromEntries(requiredVisibleKeys.map((k) => [k, "complete"])) as Record<WizardStepKey, StepStatus>,
    );
    // departments stays 'todo' because HR is off and it was never done.
    expect(statuses["departments"]).toBe("todo");
    // Old behaviour (checking the full static required list) would be false here.
    expect(allRequiredComplete(statuses)).toBe(false);
    // New behaviour: scoped to the visible steps, the office is ready.
    expect(allRequiredComplete(statuses, visible)).toBe(true);
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
