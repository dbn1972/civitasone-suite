export function computeRtiDeadline(createdAt: Date): Date {
  const deadline = new Date(createdAt);
  deadline.setDate(deadline.getDate() + 30);
  return deadline;
}

export function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * GAP-CITIZEN-RTI-DETAIL-01: a first appeal under RTI Act 2005 §19(1) lies only
 * when the applicant is aggrieved by a decision/response OR the PIO has failed
 * to respond within the §7 30-day period ("deemed refusal"). A premature appeal
 * — no response yet AND the 30-day clock has NOT expired — is not maintainable.
 *
 * Conservative, fail-closed rule (the fixer-rules say decide restrictively):
 * allow iff (a response exists) OR (now > deadline). Otherwise the caller must
 * reject with 409 APPEAL_NOT_ALLOWED.
 *
 * Pure function (no DB / no I/O) so it is unit-testable without a database.
 *
 * @param args.hasResponse  whether the RTI already has at least one recorded response
 * @param args.deadline     the §7 statutory deadline (Date or ISO/date string)
 * @param args.now          current instant (defaults to new Date())
 */
export function isAppealAllowed(args: { hasResponse: boolean; deadline: Date | string; now?: Date }): boolean {
  if (args.hasResponse) return true;
  const deadline = args.deadline instanceof Date ? args.deadline : new Date(args.deadline.toString());
  if (isNaN(deadline.getTime())) return false; // fail closed on an unparseable deadline
  const now = args.now ?? new Date();
  return now.getTime() > deadline.getTime();
}

/** D2: RTI Act 2005 s.19(1) first appeals are decided by the appellate authority, not the CPIO tier. */
export const RTI_APPELLATE_ROLES: readonly string[] = ["rti_appellate", "super_admin"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The human responder to record on an RTI response that arrived by cross-service event.
 * Prefer the responder id carried in the event payload; fall back to the envelope actor.
 */
export function resolveResponder(payloadResponder: unknown, envelopeActor: string): string {
  return typeof payloadResponder === "string" && UUID_RE.test(payloadResponder) ? payloadResponder : envelopeActor;
}

/**
 * D2 separation of duties: who may NOT decide a first appeal. Returns the reason, or null when allowed.
 * RESPONDER: the actor recorded a response on this RTI. ASSIGNED_CPIO: the actor is the user mapped to the
 * RTI's assigned cpio_ref (cpio_directory.user_id; an unmapped entry never blocks).
 */
export function appealDecisionConflict(a: {
  actorId: string; responderIds: readonly string[]; assignedCpioUserId?: string | null;
}): "RESPONDER" | "ASSIGNED_CPIO" | null {
  if (a.responderIds.includes(a.actorId)) return "RESPONDER";
  if (a.assignedCpioUserId && a.assignedCpioUserId === a.actorId) return "ASSIGNED_CPIO";
  return null;
}
