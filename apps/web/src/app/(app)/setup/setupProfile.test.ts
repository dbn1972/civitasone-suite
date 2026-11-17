import { describe, expect, it } from "vitest";
import { onboardingStepsFor } from "@civitasone/tenant-profile";
import { WIZARD_STEPS, PROFILE_WIZARD_STEPS, stepsForProfile } from "@/lib/setupSteps";
import { LEGACY_SETUP_PROFILE, mapSetupProfile } from "./setupProfile";

const keysFor = (code: string | null, live: boolean) => stepsForProfile([...WIZARD_STEPS, ...PROFILE_WIZARD_STEPS], onboardingStepsFor(code, live)).map((s) => s.key);
const PRE_B8 = ["org-profile", "branches", "departments", "people", "modules", "finance-year-coa", "leave-policies", "pay-structure"];

describe("B8 web setup wizard step visibility per profile", () => {
  it("govt_dept, section8 and legacy/flag-off show exactly the pre-B8 eight steps (unchanged)", () => {
    expect(keysFor("govt_dept", true)).toEqual(PRE_B8);
    expect(keysFor("section8", true)).toEqual(PRE_B8);
    expect(keysFor("govt_small_office", false)).toEqual(PRE_B8);
    expect(keysFor(null, false)).toEqual(PRE_B8);
    expect(stepsForProfile([...WIZARD_STEPS, ...PROFILE_WIZARD_STEPS], LEGACY_SETUP_PROFILE.onboardingSteps).map((s) => s.key)).toEqual(PRE_B8);
  });
  it("govt_small_office adds the DDO + allotment step", () => {
    expect(keysFor("govt_small_office", true)).toEqual([...PRE_B8, "ddo-allotment"]);
  });
  it("the DDO step is optional so it never changes readiness, and points at the allocation screen", () => {
    const s = PROFILE_WIZARD_STEPS.find((x) => x.key === "ddo-allotment")!;
    expect(s.required).toBe(false);
    expect(s.entryHref).toBe("/finance/budget/allocation");
  });
});

describe("mapSetupProfile", () => {
  it("live active profile -> label + catalogue steps", () => {
    const r = mapSetupProfile({ data: { profileCode: "govt_small_office", profile: { code: "govt_small_office", label: "Small government office", active: true } } });
    expect(r?.label).toBe("Small government office");
    expect(r?.onboardingSteps).toEqual(["ddo-allotment"]);
  });
  it("profile switch not live (active false) -> legacy steps, no label", () => {
    const r = mapSetupProfile({ profileCode: "section8", profile: { code: "section8", label: "Section 8 company", active: false } });
    expect(r?.label).toBeNull();
    expect(r?.onboardingSteps).toEqual(LEGACY_SETUP_PROFILE.onboardingSteps);
  });
  it("garbage -> null", () => {
    expect(mapSetupProfile("x")).toBeNull();
    expect(mapSetupProfile(null)).toBeNull();
  });
});
