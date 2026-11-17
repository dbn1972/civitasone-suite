/**
 * Default ULB / tenant onboarding wizard steps (FN-17).
 * Stage 3 activates a Domain Pack (municipal-in-v1 by default).
 *
 * B8: the step SET is data-keyed on the tenant-profile catalogue (ProfileDef.onboardingSteps, read through
 * onboardingStepsFor). Called with no step ids it returns exactly the pre-B8 three steps.
 */
import { LEGACY_ONBOARDING_STEPS, type OnboardingStepId } from "@civitasone/tenant-profile";
import type { CreateWizardBody } from "./validators.js";
import { MUNICIPAL_ONBOARDING_PACK_KEYS } from "./domain-pack-constants.js";

export const ONBOARDING_WIZARD_NAME = "tenant-onboarding";
export const DOMAIN_PACK_ACTIVATE_HANDLER = "activate_domain_pack";
export const STAGE3_STEP_KEY = "activate-domain-pack";
export const DDO_ALLOTMENT_STEP_KEY = "setup-ddo-allotment";

type Step = CreateWizardBody["steps"][number];

export function defaultOnboardingSteps(
  domainPackKey = "municipal-in-v1",
  stepIds: readonly OnboardingStepId[] = LEGACY_ONBOARDING_STEPS,
): CreateWizardBody["steps"] {
  const steps: Step[] = [
    {
      stepKey: "deployment-mode",
      title: "Choose deployment mode",
      description: "Select shared SaaS, silo, or on-prem placement for this tenant.",
      isRequired: true,
      dependsOn: [],
      handlerType: "manual",
      config: {},
      sortOrder: 1,
    },
    {
      stepKey: "org-profile",
      title: "Configure organisation profile",
      description: "Set jurisdiction, offices, and admin contacts.",
      isRequired: true,
      dependsOn: ["deployment-mode"],
      handlerType: "manual",
      config: {},
      sortOrder: 2,
    },
  ];
  if (stepIds.includes("ddo-allotment")) {
    steps.push({
      stepKey: DDO_ALLOTMENT_STEP_KEY,
      title: "Set up DDO and budget allotment",
      description: "Register the Drawing and Disbursing Officer (DDO) for this office and record its budget allotment.",
      isRequired: true,
      dependsOn: ["org-profile"],
      handlerType: "manual",
      config: {},
      sortOrder: steps.length + 1,
    });
  }
  if (stepIds.includes("municipal-pack")) {
    steps.push({
      stepKey: STAGE3_STEP_KEY,
      title: "Activate Domain Pack",
      description:
        "Browse and activate a Domain Pack (default municipal-in-v1) to import Trade License, PGR, and Water drafts for local review.",
      isRequired: true,
      dependsOn: ["org-profile"],
      handlerType: DOMAIN_PACK_ACTIVATE_HANDLER,
      config: {
        domainPackKey,
        packKeys: [...MUNICIPAL_ONBOARDING_PACK_KEYS],
        stageNumber: 3,
      },
      sortOrder: steps.length + 1,
    });
  }
  return steps;
}
