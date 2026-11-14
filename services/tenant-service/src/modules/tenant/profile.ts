/**
 * Tenant-type profile: resolve the profile of a new tenant and decorate a tenant view for the read API.
 * The catalogue lives in @civitasone/tenant-profile; this file is the tenant-service glue.
 */
import { defaultProfileCode, describeProfile, getProfile, isProfileAllowedForEdition, tenantProfilesEnabled } from "@civitasone/tenant-profile";
import { HttpError } from "../../shared/context.js";
import type { TenantView } from "./domain.js";

/**
 * The profile a new tenant gets. No request -> the edition default (govt -> govt_dept), which is today's behaviour.
 * A non-default profile needs TENANT_PROFILES_ENABLED and must belong to the edition.
 */
export function resolveProfileCode(edition: string, requested: string | undefined, flagOn: boolean = tenantProfilesEnabled()): string {
  const fallback = defaultProfileCode(edition);
  if (requested === undefined || requested === fallback) return fallback;
  if (!getProfile(requested) || !isProfileAllowedForEdition(requested, edition)) {
    throw new HttpError(422, "INVALID_PROFILE", `profile ${requested} is not available for edition ${edition}`);
  }
  if (!flagOn) throw new HttpError(422, "PROFILES_NOT_ENABLED", "tenant profiles are not enabled on this deployment");
  return requested;
}

/** The view GET /v1/tenants/:id returns: profileCode always set, plus the resolved profile block. */
export function withProfile(view: TenantView, flagOn: boolean = tenantProfilesEnabled()): TenantView {
  const profileCode = view.profileCode ?? defaultProfileCode(view.edition);
  return { ...view, profileCode, profile: describeProfile(profileCode, flagOn) };
}
