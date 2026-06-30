/** DFA (Draft For Approval) state machine — pure, no I/O. */

export const DFA_STATUSES = [
  "draft", "pending_approval", "approved", "returned", "signed", "dispatched",
] as const;
export type DfaStatus = (typeof DFA_STATUSES)[number];

const TRANSITIONS: Record<DfaStatus, DfaStatus[]> = {
  draft:            ["pending_approval"],
  pending_approval: ["approved", "returned"],
  returned:         ["pending_approval"],     // revise & resubmit
  approved:         ["signed"],
  signed:           ["dispatched"],
  dispatched:       [],
};

export function canTransition(from: string, to: DfaStatus): boolean {
  const allowed = TRANSITIONS[from as DfaStatus];
  return Array.isArray(allowed) && allowed.includes(to);
}

/** Editable only while draft or returned. */
export function isEditable(status: string): boolean {
  return status === "draft" || status === "returned";
}

/**
 * Format a GAPLESS DFA number. The serial is allocated atomically from
 * `files.estab_doc_seq` in the consumer transaction (see `repo.allocateDfaNo`),
 * never from `Math.random()`, so the DFA register has no gaps or collisions.
 * Format: `DFA/<TYPE>/<year>/<5-digit serial>` e.g. `DFA/LET/2026/00001`.
 */
export function formatDfaNo(communicationType: string, year: number, seq: number): string {
  const prefix = communicationType.slice(0, 3).toUpperCase();
  return `DFA/${prefix}/${year}/${String(seq).padStart(5, "0")}`;
}
