import { describe, expect, it } from "vitest";
import { LEGACY_ONBOARDING_STEPS, ONBOARDING_STEP_IDS, PROFILES, onboardingStepsFor } from "../src/index.js";

describe("B8 onboardingStepsFor (catalogue-driven setup steps)", () => {
  it("govt_dept keeps the municipal pack and nothing else (unchanged)", () => {
    expect(onboardingStepsFor("govt_dept", true)).toEqual(["municipal-pack"]);
  });
  it("govt_small_office drops the municipal pack and adds DDO + allotment", () => {
    const s = onboardingStepsFor("govt_small_office", true);
    expect(s).toContain("ddo-allotment");
    expect(s).not.toContain("municipal-pack");
  });
  it("section8 gets neither municipal pack nor DDO", () => {
    expect(onboardingStepsFor("section8", true)).toEqual([]);
  });
  it("flag off, unknown, absent or placeholder profile resolve to the legacy set", () => {
    expect(onboardingStepsFor("section8", false)).toBe(LEGACY_ONBOARDING_STEPS);
    expect(onboardingStepsFor("govt_small_office", false)).toBe(LEGACY_ONBOARDING_STEPS);
    expect(onboardingStepsFor("nope", true)).toBe(LEGACY_ONBOARDING_STEPS);
    expect(onboardingStepsFor(null, true)).toBe(LEGACY_ONBOARDING_STEPS);
    expect(onboardingStepsFor(undefined, true)).toBe(LEGACY_ONBOARDING_STEPS);
    // PSU v1-B: psu is active; a company is not a municipality, so with the flag on it adds no onboarding steps (flag off: legacy)
    expect(onboardingStepsFor("psu", true)).toEqual([]);
    expect(onboardingStepsFor("psu", false)).toBe(LEGACY_ONBOARDING_STEPS);
    expect(onboardingStepsFor("small_office", true)).toBe(LEGACY_ONBOARDING_STEPS);
  });
  it("every profile only lists known step ids", () => {
    for (const p of PROFILES) for (const id of p.onboardingSteps) expect(ONBOARDING_STEP_IDS).toContain(id);
  });
});
