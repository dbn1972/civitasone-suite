import { describe, expect, it } from "vitest";
import { onboardingStepsFor } from "@civitasone/tenant-profile";
import { DDO_ALLOTMENT_STEP_KEY, STAGE3_STEP_KEY, defaultOnboardingSteps } from "../src/modules/orchestrator/onboarding.js";

const keys = (s: ReturnType<typeof defaultOnboardingSteps>) => s.map((x) => x.stepKey);

describe("B8 onboarding wizard step visibility per profile", () => {
  it("no step ids (legacy / govt_dept / flag off) = the pre-B8 three steps, same order and sortOrder", () => {
    const legacy = defaultOnboardingSteps();
    expect(keys(legacy)).toEqual(["deployment-mode", "org-profile", STAGE3_STEP_KEY]);
    expect(legacy.map((s) => s.sortOrder)).toEqual([1, 2, 3]);
    expect(defaultOnboardingSteps("municipal-in-v1", onboardingStepsFor("govt_dept", true))).toEqual(legacy);
    expect(defaultOnboardingSteps("municipal-in-v1", onboardingStepsFor("section8", false))).toEqual(legacy);
  });
  it("section8 / commercial: the municipal pack step is skipped", () => {
    const s = defaultOnboardingSteps("municipal-in-v1", onboardingStepsFor("section8", true));
    expect(keys(s)).toEqual(["deployment-mode", "org-profile"]);
  });
  it("govt_small_office: DDO + allotment step added, municipal pack skipped", () => {
    const s = defaultOnboardingSteps("municipal-in-v1", onboardingStepsFor("govt_small_office", true));
    expect(keys(s)).toEqual(["deployment-mode", "org-profile", DDO_ALLOTMENT_STEP_KEY]);
    expect(s[2]?.dependsOn).toEqual(["org-profile"]);
    expect(s[2]?.sortOrder).toBe(3);
  });
  it("both ids give contiguous sortOrder and resolvable dependsOn", () => {
    const s = defaultOnboardingSteps("municipal-in-v1", ["ddo-allotment", "municipal-pack"]);
    expect(s.map((x) => x.sortOrder)).toEqual([1, 2, 3, 4]);
    const have = new Set(keys(s));
    for (const x of s) for (const d of x.dependsOn) expect(have.has(d)).toBe(true);
  });
});
