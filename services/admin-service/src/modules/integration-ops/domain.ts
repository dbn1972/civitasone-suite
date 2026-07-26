/**
 * CAP-060 — dead-letter lifecycle. A dead letter is `pending` until an operator
 * requeues (replays) it or discards it; both are terminal for that row. A
 * requeued message that fails again is re-ingested as its own new dead letter.
 */
// `requeuing` is a short-lived interim state: a requeue has claimed the row
// (CAS pending->requeuing) but not yet finished publishing. It is not operator-
// actionable; a failed publish reverts it to `pending`, a successful one to
// `requeued`. It exists so two concurrent requeues cannot both publish.
export type DlqStatus = "pending" | "requeuing" | "requeued" | "discarded";
export type DlqAction = "requeue" | "discard";

export class DlqError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "DlqError";
  }
}

const TRANSITIONS: Record<DlqStatus, Partial<Record<DlqAction, DlqStatus>>> = {
  pending: { requeue: "requeued", discard: "discarded" },
  // A row mid-requeue is claimed — no operator action is valid until it settles.
  requeuing: {},
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
