/**
 * evidence pure domain — the evidence/exhibit state machine, id derivation, and
 * content-hash validation (§22). No I/O — every function here is deterministic and
 * side-effect free so it is trivially unit-testable and safe to call from both the
 * command and consumer paths.
 */
import { createHash } from "node:crypto";
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";

export const EVIDENCE_STATUSES = ["submitted", "admitted", "rejected", "marked"] as const;
export type EvidenceStatus = typeof EVIDENCE_STATUSES[number];

/**
 * A submitted exhibit can be admitted, rejected, or marked (marked = tendered and
 * marked for identification, pending a final admit/reject ruling). A marked exhibit
 * can then be admitted or rejected. admitted and rejected are terminal.
 */
const TRANSITIONS: Record<EvidenceStatus, EvidenceStatus[]> = {
  submitted: ["admitted", "rejected", "marked"],
  marked:    ["admitted", "rejected"],
  admitted:  [],
  rejected:  [],
};

export function canTransition(from: EvidenceStatus, to: EvidenceStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: string, to: EvidenceStatus): void {
  if (!canTransition(from as EvidenceStatus, to)) {
    throw new Error(`INVALID_EVIDENCE_TRANSITION: cannot move evidence from '${from}' to '${to}'`);
  }
}

/** admitted and rejected are terminal states for an exhibit. */
export function isTerminal(status: string): boolean {
  return status === "admitted" || status === "rejected";
}

/**
 * A SHA-256 content hash is 64 hex characters (case-insensitive). Returns true for
 * a well-formed digest so callers can guard tamper-evidence references.
 */
export function validateContentHash(hex: string): boolean {
  return /^[0-9a-f]{64}$/i.test(hex);
}

/**
 * An evidence id is deterministic on (tenant + case + exhibit-number-or-title + seq)
 * so re-submitting the SAME exhibit is idempotent end-to-end. `seq` disambiguates
 * multiple exhibits that share a title within the same case.
 */
export function deriveEvidenceId(
  tenantId: string, caseId: string, exhibitNumberOrTitle: string, seq: number,
): string {
  return deterministicId(
    COURT_NAMESPACE,
    `${tenantId}:evidence:${caseId}:${exhibitNumberOrTitle}:${seq}`,
  );
}

/**
 * Fields of a submission that define an exhibit's actual content, consumed by
 * `submissionDisambiguator` below. Kept as a standalone shape (rather than importing
 * `SubmitEvidenceBody`) so this pure-domain module has no dependency on the
 * validators/zod layer. The `| undefined` on each optional matches how zod's
 * `.optional()` infers under this project's `exactOptionalPropertyTypes`.
 */
export type SubmissionContentFields = {
  exhibitNumber?: string | undefined;
  title: string;
  filingId?: string | undefined;
  evidenceType?: string | undefined;
  storageRef?: string | undefined;
  contentHash?: string | undefined;
};

/**
 * The `seq` disambiguator for `deriveEvidenceId`, derived from a hash of every field
 * that defines this submission's content — NOT a hardcoded constant and NOT a
 * stateful counter. A byte-for-byte retry of the same request (e.g. a client
 * resending after a network timeout) hashes to the same value here, so the derived
 * evidence id is unchanged and the resubmission dedupes as intended (via
 * `insertEvidence`'s `onConflictDoNothing` / the consumer's `markProcessed`). Two
 * DIFFERENT exhibits that happen to share a title or exhibit number hash to
 * different values instead, so they get different ids rather than one silently
 * clobbering the other.
 */
export function submissionDisambiguator(fields: SubmissionContentFields): number {
  const digest = createHash("sha256")
    .update(JSON.stringify({
      exhibitNumber: fields.exhibitNumber ?? null,
      title: fields.title,
      filingId: fields.filingId ?? null,
      evidenceType: fields.evidenceType ?? null,
      storageRef: fields.storageRef ?? null,
      contentHash: fields.contentHash ?? null,
    }))
    .digest("hex");
  // 8 hex chars = 32 bits — comfortably a safe integer, and far more disambiguating
  // range than any one case will plausibly have same-titled exhibits.
  return parseInt(digest.slice(0, 8), 16);
}

/**
 * Default evidence/exhibit TYPES (§22) used as a FALLBACK when a tenant has not
 * configured its own `evidence_type` namespace in the config/metadata engine
 * (§47). The effective allowed set is the tenant config when present, else these
 * defaults, so an admin can ADD a bespoke evidence type with no code change.
 * NOTE: this is the TYPE field, distinct from the EVIDENCE_STATUSES state machine.
 */
export const DEFAULT_EVIDENCE_TYPES = [
  "document", "photo", "video", "audio", "physical", "affidavit", "witness",
] as const;

/** Throw INVALID_EVIDENCE_TYPE unless `t` is in the effective allowed set. */
export function assertEvidenceTypeAllowed(t: string, allowed: ReadonlySet<string>): void {
  if (!allowed.has(t)) {
    throw new Error(`INVALID_EVIDENCE_TYPE: ${t} is not an allowed evidence type for this tenant`);
  }
}
