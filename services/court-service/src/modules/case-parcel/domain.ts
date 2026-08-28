/**
 * case-parcel pure domain — parcel id derivation, survey-number normalization,
 * and the subject-type vocabulary. No I/O; every function is deterministic.
 *
 * There is NO state machine here: a parcel is a linkage record with a soft
 * active/inactive flag, not a lifecycle entity.
 */
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";

/**
 * Canonical form of a survey/khasra number: trimmed and upper-cased. Revenue
 * identifiers are written inconsistently ("12/3a" vs " 12/3A "); normalizing
 * before both id derivation and search makes re-adds idempotent and lookups
 * case-insensitive.
 */
export function normalizeSurvey(s: string): string {
  return s.trim().toUpperCase();
}

/**
 * What is under dispute for a given parcel row. `land` is the default; the other
 * subjects (a structure, a water body, a tree/crop stand, or an unclassified
 * 'other') let a single case attach heterogeneous immovable subjects.
 */
export const SUBJECT_TYPES = ["land", "structure", "water_body", "tree_crop", "other"] as const;
export type SubjectType = typeof SUBJECT_TYPES[number];

export function isValidSubjectType(t: string): t is SubjectType {
  return (SUBJECT_TYPES as readonly string[]).includes(t);
}

/**
 * A parcel id is deterministic on (tenant + case + normalized survey + normalized
 * khasra) — so re-adding the SAME parcel to the SAME case is idempotent end-to-end
 * (the insert is an ON CONFLICT DO NOTHING no-op). khasra is optional; when absent
 * it contributes an empty segment so (survey only) and (survey + khasra) yield
 * distinct ids.
 */
export function deriveParcelId(
  tenantId: string,
  caseId: string,
  surveyNumber: string,
  khasraNumber?: string,
): string {
  const survey = normalizeSurvey(surveyNumber);
  const khasra = khasraNumber ? normalizeSurvey(khasraNumber) : "";
  return deterministicId(COURT_NAMESPACE, `${tenantId}:parcel:${caseId}:${survey}:${khasra}`);
}

/**
 * Whether an updateParcel request actually changes anything, relative to the
 * row's CURRENT active flag (the only field a request can no-op against --
 * areaSqm/ownershipRef/remarks have no server-side "current value" comparison,
 * matching the pre-existing consumer behavior this function extracts verbatim).
 * Shared by commands.ts's synchronous pre-check and consumer.ts's authoritative
 * no-op guard so the two can never drift apart -- a future field added to only
 * one of them would otherwise silently make the precheck under- or
 * over-detect a real change relative to what the consumer actually does.
 */
export function hasEffectiveParcelChange(
  body: {
    areaSqm?: number | undefined;
    ownershipRef?: string | undefined;
    remarks?: string | undefined;
    active?: boolean | undefined;
  },
  current: { active: boolean },
): boolean {
  const changesActive = body.active !== undefined && body.active !== current.active;
  const changesOther =
    body.areaSqm !== undefined || body.ownershipRef !== undefined || body.remarks !== undefined;
  return changesActive || changesOther;
}
