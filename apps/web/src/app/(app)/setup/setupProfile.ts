/**
 * B8: the resolved tenant profile for the setup wizard. Reads GET /v1/tenants/current (tenant-service describeProfile
 * block) and maps it through the tenant-profile catalogue: the step set comes from `onboardingStepsFor`, never from a
 * profile/edition string. `profile.active` is the server's own "flag on AND profile active" answer, so a flag-off
 * deployment (or an unknown/placeholder profile) resolves to the legacy set and the wizard is unchanged.
 */
import { onboardingStepsFor, LEGACY_ONBOARDING_STEPS, type OnboardingStepId } from "@civitasone/tenant-profile";
import { fetchJson } from "@/app/_data/apiClient";

export type SetupProfile = {
  /** Profile label to show in the wizard, or null when the profile switch is not live for this tenant. */
  label: string | null;
  onboardingSteps: readonly OnboardingStepId[];
};

export const LEGACY_SETUP_PROFILE: SetupProfile = { label: null, onboardingSteps: LEGACY_ONBOARDING_STEPS };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Pure mapping of a tenants/current payload; unit-tested without fetch. */
export function mapSetupProfile(payload: unknown): SetupProfile | null {
  const rec = isRecord(payload) && isRecord(payload.data) ? payload.data : isRecord(payload) ? payload : null;
  if (!rec) return null;
  const block = isRecord(rec.profile) ? rec.profile : null;
  const code = typeof rec.profileCode === "string" ? rec.profileCode : typeof block?.code === "string" ? block.code : null;
  const live = block?.active === true;
  return {
    label: live && typeof block?.label === "string" && block.label.length > 0 ? block.label : null,
    onboardingSteps: onboardingStepsFor(code, live),
  };
}

export async function getSetupProfile(): Promise<SetupProfile> {
  try {
    const res = await fetchJson<unknown, SetupProfile>("/api/v1/tenants/current", LEGACY_SETUP_PROFILE, {
      revalidateSeconds: 60,
      telemetryKey: "setup.profile",
      mapResponse: mapSetupProfile,
    });
    return res.source === "error" ? LEGACY_SETUP_PROFILE : res.data;
  } catch {
    return LEGACY_SETUP_PROFILE;
  }
}
