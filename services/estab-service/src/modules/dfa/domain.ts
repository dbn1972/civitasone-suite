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

export function nextDfaNo(communicationType: string): string {
  const year = new Date().getFullYear();
  const prefix = communicationType.slice(0, 3).toUpperCase();
  const seq = String(Math.floor(Math.random() * 9000) + 1000);
  return `DFA/${prefix}/${year}/${seq}`;
}
