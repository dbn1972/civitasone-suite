/**
 * party pure domain — party-role helpers and id derivation (§14/§15). No I/O —
 * every function here is deterministic and side-effect free.
 */
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";

/** Canonical party roles (mirrors validators.PARTY_ROLE_VALUES). */
export const PARTY_ROLES = [
  "petitioner",
  "respondent",
  "applicant",
  "opposite_party",
  "intervenor",
  "advocate",
  "witness",
] as const;
export type PartyRole = typeof PARTY_ROLES[number];

export function isValidRole(role: string): role is PartyRole {
  return (PARTY_ROLES as readonly string[]).includes(role);
}

/** A party id is deterministic on (tenant + case + role + seq) so re-submitting
 *  the SAME party (same case + role + ordinal) is idempotent end-to-end. */
export function derivePartyId(tenantId: string, caseId: string, partyRole: string, seq: number): string {
  return deterministicId(COURT_NAMESPACE, `${tenantId}:party:${caseId}:${partyRole}:${seq}`);
}

/**
 * Throw INVALID_PARTY_ROLE unless `role` is in the effective allowed set. The
 * PARTY_ROLES above are the FALLBACK defaults for the config/metadata engine
 * (§47) `party_role` namespace; when a tenant configures that namespace its set
 * is AUTHORITATIVE and REPLACES these defaults (they are NOT implicitly retained),
 * so the tenant’s list fully overrides the fallback and may add bespoke roles
 * with no code change.
 */
export function assertPartyRoleAllowed(role: string, allowed: ReadonlySet<string>): void {
  if (!allowed.has(role)) {
    throw new Error(`INVALID_PARTY_ROLE: ${role} is not an allowed party role for this tenant`);
  }
}
