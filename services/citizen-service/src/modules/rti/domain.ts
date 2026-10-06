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
