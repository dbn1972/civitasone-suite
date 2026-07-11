/**
 * evidence pure domain — the evidence/exhibit state machine, id derivation, and
 * content-hash validation (§22). No I/O — every function here is deterministic and
 * side-effect free so it is trivially unit-testable and safe to call from both the
 * command and consumer paths.
 */
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
