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
