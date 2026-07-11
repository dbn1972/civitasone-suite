/**
 * Pure domain rules for the case-registry module: CNR validation, the case
 * lifecycle state machine, and initial-status derivation. No I/O — every
 * function here is deterministic and side-effect free so it is trivially
 * unit-testable and safe to call from both the command and consumer paths.
 */

export const CASE_STATUSES = [
  "filed",
  "registered",
  "admitted",
  "pending",
  "part_heard",
  "reserved",
  "disposed",
  "appealed",
] as const;
export type CaseStatus = typeof CASE_STATUSES[number];

/**
 * The canonical CNR (Case Number Record) is a 16-character alphanumeric code:
 * 4-letter court/establishment code + 12 digits (e.g. DLHC01-0001234-2026 with
 * separators stripped). We guard the normalized (separator-free) form here and
 * leave presentational formatting to the UI.
 */
const CNR_RE = /^[A-Za-z0-9]{16}$/;

export function normalizeCnr(cnr: string): string {
  return cnr.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function validateCnr(cnr: string): string {
  const normalized = normalizeCnr(cnr);
  if (!CNR_RE.test(normalized)) {
    throw new Error(`INVALID_CNR: '${cnr}' is not a valid 16-character CNR number`);
  }
  return normalized;
}

/** Every newly filed case starts in the 'filed' state. */
export function deriveInitialStatus(): CaseStatus {
  return "filed";
}

/**
 * Case lifecycle: filed → registered → admitted → pending → part_heard →
 * reserved → disposed → appealed. Realistic side-branches are allowed
 * (a reserved matter can return to part_heard for further hearing; an appealed
 * matter re-enters the pipeline as pending in the appellate forum) but the
 * forward spine is the contract.
 */
const TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  filed:      ["registered"],
  registered: ["admitted"],
  admitted:   ["pending"],
  pending:    ["part_heard", "reserved", "disposed"],
  part_heard: ["reserved", "pending", "disposed"],
  reserved:   ["disposed", "part_heard"],
  disposed:   ["appealed"],
  appealed:   ["pending"],
};

export function canTransition(from: CaseStatus, to: CaseStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: string, to: CaseStatus): void {
  if (!canTransition(from as CaseStatus, to)) {
    throw new Error(`INVALID_TRANSITION: cannot move case from '${from}' to '${to}'`);
  }
}
