/**
 * B6: the pension scheme an employee with none recorded defaults to, read from the tenant's catalogue
 * `statutoryPack` (govt_in -> NPS; commercial_in / nonprofit_in -> EPF) instead of a hard-coded "NPS".
 *
 * Flag-gated: with TENANT_PROFILES_ENABLED off no read is made and the default is NPS, exactly as before. With it on
 * the tenant profile is read through readTenantDocIdentity (the 60 s cache, FAIL-CLOSED tenant-service read): an
 * unreadable tenant-service throws TenantIdentityUnavailableError (the caller must not guess a scheme and price a slip
 * with it). A tenant tenant-service answers 404 for, or one with no profileCode, is the legacy govt default (NPS).
 */
import { defaultPensionSchemeFor, effectiveSettings, tenantProfilesEnabled } from "@civitasone/tenant-profile";
import type { PensionScheme } from "../payroll/domain.js";
import { readTenantDocIdentity, type FetchLike } from "../deductor-config/tenant-identity.js";

export async function resolveTenantPensionDefault(
  tenantId: string,
  opts: { flagOn?: boolean; fetchImpl?: FetchLike } = {},
): Promise<PensionScheme> {
  if (!(opts.flagOn ?? tenantProfilesEnabled())) return "NPS";
  const id = await readTenantDocIdentity(tenantId, opts.fetchImpl);
  if (id.registered === false || !id.profileCode) return "NPS";
  return defaultPensionSchemeFor(effectiveSettings(id.profileCode, true).statutoryPack);
}
