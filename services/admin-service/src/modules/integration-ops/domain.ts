/**
 * CAP-060 — dead-letter lifecycle. A dead letter is `pending` until an operator
 * requeues (replays) it or discards it; both are terminal for that row. A
 * requeued message that fails again is re-ingested as its own new dead letter.
 */
export type DlqStatus = "pending" | "requeued" | "discarded";
export type DlqAction = "requeue" | "discard";

export class DlqError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "DlqError";
  }
}

const TRANSITIONS: Record<DlqStatus, Partial<Record<DlqAction, DlqStatus>>> = {
  pending: { requeue: "requeued", discard: "discarded" },
  requeued: {},
  discarded: {},
};

export function isTerminal(status: DlqStatus): boolean {
  return status === "requeued" || status === "discarded";
}

export function applyDlqAction(current: DlqStatus, action: DlqAction): DlqStatus {
  const next = TRANSITIONS[current][action];
  if (!next) {
    throw new DlqError("INVALID_TRANSITION", `cannot ${action} a dead letter in status ${current}`);
  }
  return next;
}
