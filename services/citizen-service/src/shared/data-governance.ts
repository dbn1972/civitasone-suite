/**
 * CAP-084/085/086 adoption — citizen-service data-governance policy.
 *
 * Single source of truth for how citizen profile personal data is governed,
 * built on the shared @civitasone/data-governance engine:
 *  - consent purposes (DPDP §7)         -> ConsentRegistry
 *  - field masking for non-privileged reads (DPDP §5) -> applyMasking
 *  - retention + erasure (DPDP §8(7),§12) -> retention helpers / eraseFields
 */
import {
  ConsentRegistry, type Purpose,
  applyMasking, type MaskingPolicy,
  eraseFields, type RetentionPolicy,
} from "@civitasone/data-governance";

/** Purposes for which citizen personal data may be processed. */
export const CITIZEN_PURPOSES: Purpose[] = [
  { key: "profile_management", description: "Maintain the citizen's service profile" },
  { key: "service_delivery", description: "Deliver a requested government service", legitimateUse: true },
  { key: "grievance_handling", description: "Process grievances and RTI requests", legitimateUse: true },
  { key: "notifications", description: "Send service notifications (opt-in)" },
];

export function makeCitizenConsentRegistry(): ConsentRegistry {
  return new ConsentRegistry(CITIZEN_PURPOSES);
}

/** Roles that may read citizen PII unmasked. */
export const CITIZEN_PII_ROLES = ["citizen_officer", "grievance_officer", "super_admin"];

export const CITIZEN_PROFILE_MASKING: MaskingPolicy = {
  email: { strategy: "email", allowRoles: CITIZEN_PII_ROLES },
  mobile: { strategy: "partial4", allowRoles: CITIZEN_PII_ROLES },
  address: { strategy: "redact", allowRoles: CITIZEN_PII_ROLES },
  digilockerToken: { strategy: "hash", allowRoles: CITIZEN_PII_ROLES },
};

export function maskCitizenProfile<T extends Record<string, unknown>>(profile: T, roles: string[] = []): T {
  return applyMasking(profile, CITIZEN_PROFILE_MASKING, roles);
}

/** Statutory retention for a citizen profile (7 years default; override per deployment). */
export const CITIZEN_PROFILE_RETENTION: RetentionPolicy = { category: "citizen_profile", retainDays: 2555 };

/** PII fields erased on a DPDP §12 right-to-erasure request. */
export const CITIZEN_PROFILE_PII_FIELDS = ["name", "email", "mobile", "digilockerToken", "address"] as const;

/**
 * Canonical DB erasure values applied by repo.anonymiseProfile. `name` is
 * tombstoned (kept non-null for a UI-friendly "[DELETED]"), contact fields are
 * nulled. Exported so the write path and any object-level erasure agree.
 */
export const CITIZEN_PROFILE_ERASURE_SET = {
  name: "[DELETED]",
  email: null,
  mobile: null,
  digilockerToken: null,
  address: null,
} as const;

/** Object-level erasure for cached/API profile representations. */
export function eraseCitizenProfile<T extends Record<string, unknown>>(profile: T): T {
  return eraseFields(profile, [...CITIZEN_PROFILE_PII_FIELDS], "tombstone");
}
