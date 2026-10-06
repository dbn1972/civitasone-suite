/**
 * Canonical RTI (Right to Information Act 2005) status vocabulary and the
 * single source of truth for "is this application's statutory clock closed?".
 *
 * GAP-CITIZEN-RTI-05 / GAP-CITIZEN-RTI-DETAIL-05: the list view
 * (RTIClient.tsx) and the detail view ([id]/RTIDetailClient.tsx) each had
 * their OWN, DIVERGING idea of which statuses close the 30-day clock:
 *   - list:   CLOSED = { replied, closed, appeal }
 *   - detail: closed = { replied, closed, appeal, responded, appealed } OR any response present
 * so the same RTI could show a running clock in one screen and "disposed" in
 * the other. This module unifies both.
 *
 * The canonical read-model status enum is the one the backend read model
 * actually emits (citizen-service rti/queries.ts mapRtiStatus → and
 * packages/schemas RTISummarySchema): received | forwarded | under_review |
 * replied | appeal | closed. The write side persists an internal vocabulary
 * (filed | responded | appealed | transferred | closed); the mapper folds
 * `responded`→`replied` and `appealed`→`appeal`. We accept BOTH vocabularies
 * here (defence in depth) so a raw write-side status never reopens a clock
 * that the mapped read model considers closed.
 */

/** Read-model statuses (what the API's summary/detail normally carries). */
export const RTI_READ_STATUSES = [
  "received",
  "forwarded",
  "under_review",
  "replied",
  "appeal",
  "closed",
] as const;

export type RtiReadStatus = (typeof RTI_READ_STATUSES)[number];

/**
 * Statuses that STOP the §7 statutory 30-day clock. `replied`/`appeal` are the
 * read-model terminal states; `responded`/`appealed`/`closed` are the write-side
 * synonyms kept for forward-compatibility so either vocabulary closes the clock.
 */
export const RTI_CLOSED_STATUSES: ReadonlySet<string> = new Set([
  "replied",
  "appeal",
  "closed",
  // write-side synonyms (defence in depth)
  "responded",
  "appealed",
]);

/**
 * True when the application's statutory clock is closed. A recorded response
 * also closes it even if the status field has not yet been re-projected
 * (read-your-writes lag): a response is the irreversible §7 disposal event.
 *
 * @param status           the application status (read-model OR write-side vocabulary)
 * @param responsesCount   number of recorded PIO responses (optional; detail view)
 */
export function isRtiClosed(status: string | null | undefined, responsesCount = 0): boolean {
  if (responsesCount > 0) return true;
  if (!status) return false;
  return RTI_CLOSED_STATUSES.has(status);
}
