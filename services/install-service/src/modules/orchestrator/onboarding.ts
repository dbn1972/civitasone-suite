/**
 * Default ULB / tenant onboarding wizard steps (FN-17).
 * Stage 3 activates a Domain Pack (municipal-in-v1 by default).
 */
import type { CreateWizardBody } from "./validators.js";
import { MUNICIPAL_ONBOARDING_PACK_KEYS } from "./domain-pack-constants.js";

export const ONBOARDING_WIZARD_NAME = "tenant-onboarding";
export const DOMAIN_PACK_ACTIVATE_HANDLER = "activate_domain_pack";
export const STAGE3_STEP_KEY = "activate-domain-pack";

export function defaultOnboardingSteps(
  domainPackKey = "municipal-in-v1",
): CreateWizardBody["steps"] {
  return [
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
    {
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
      sortOrder: 3,
    },
  ];
}
