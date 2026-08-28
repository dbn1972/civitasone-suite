/**
 * party pure domain — party-role helpers and id derivation (§14/§15). No I/O —
 * every function here is deterministic and side-effect free.
 */
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";
import { maskEmail as maskEmailImpl, maskPhone as maskPhoneImpl } from "../../shared/pii-crypto.js";

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

/**
 * Roles allowed to see FULL cleartext party PII (name/address/phone/email).
 * All other roles receive masked phone/email and REDACTED name/address (null).
 * DPDP Act 2023 data minimization (Req 15.3): expose the least PII the
 * caller's role needs.
 *
 * SINGLE SOURCE OF TRUTH: both party/routes.ts (GET .../parties) and
 * case-registry/routes.ts (GET .../cases/:id, which embeds a case's parties)
 * call `presentParty` below with this list — the two endpoints read the SAME
 * `court.case_parties` table (see schema.ts) and must never disagree on what
 * PII a role may see. (Bug history: case-registry's embed used to skip this
 * masking entirely and leak full cleartext PII to every COURT_READ_ROLES
 * caller, including registrar/court_clerk who are NOT privileged here.)
 */
export const PII_PRIVILEGED_ROLES = Object.freeze([
  "judge", "court_admin", "super_admin",
]) as string[];
// Frozen (not just typed) so an accidental push()/mutation from either
// consuming routes.ts throws immediately at runtime instead of silently
// widening PII access on BOTH endpoints that share this constant.

/** The shape every case_parties row is presented as on the wire. */
export interface PresentedParty {
  id: string;
  caseId: string;
  partyRole: string;
  advocateName: string | null;
  advocateBarId: string | null;
  version: number;
  createdAt: unknown;
  updatedAt: unknown;
  name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
}

/** The minimal case_parties row shape `presentParty` needs (decrypted cleartext,
 *  as returned by the encryptedText columns — see shared/pii-crypto.ts). */
export interface PartyRowForPresentation {
  id: string;
  caseId: string;
  partyRole: string;
  nameEnc: string | null;
  addressEnc: string | null;
  phoneEnc: string | null;
  emailEnc: string | null;
  advocateName: string | null;
  advocateBarId: string | null;
  version: number;
  createdAt: unknown;
  updatedAt: unknown;
}

/**
 * Present a case_parties row for the wire, applying the DPDP data-minimization
 * rule above. `revealPii` is `hasAnyRole(ctx, PII_PRIVILEGED_ROLES)`, computed
 * by the caller (it needs the request context, which is I/O-adjacent and does
 * not belong in this pure domain module). `maskPhone`/`maskEmail` come from
 * shared/pii-crypto.ts — pure string helpers, safe to call from domain code.
 */
export function presentParty(row: PartyRowForPresentation, revealPii: boolean): PresentedParty {
  const base = {
    id: row.id,
    caseId: row.caseId,
    partyRole: row.partyRole,
    advocateName: row.advocateName,
    advocateBarId: row.advocateBarId,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (revealPii) {
    return { ...base, name: row.nameEnc, address: row.addressEnc, phone: row.phoneEnc, email: row.emailEnc };
  }
  return { ...base, name: null, address: null, phone: maskPhoneImpl(row.phoneEnc), email: maskEmailImpl(row.emailEnc) };
}
