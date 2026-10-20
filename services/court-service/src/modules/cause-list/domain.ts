/**
 * cause-list pure domain — deterministic id derivation for idempotency (§17).
 * No I/O.
 */
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";

/** A court has exactly ONE cause-list per date, so the id is deterministic on
 *  (tenant + court + listDate) — re-generating the same day is idempotent. */
export function deriveCauseListId(tenantId: string, courtId: string, listDate: string): string {
  return deterministicId(COURT_NAMESPACE, `${tenantId}:causelist:${courtId}:${listDate}`);
}

/** A cause-list item id is deterministic on (tenant + cause-list + case) so
 *  re-listing the SAME case onto the SAME list is idempotent end-to-end. */
export function deriveItemId(tenantId: string, causeListId: string, caseId: string): string {
  return deterministicId(COURT_NAMESPACE, `${tenantId}:causelist-item:${causeListId}:${caseId}`);
}

const IST_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
});

/**
 * The hearing purpose to show for a cause-list item: the purpose of a hearing of
 * the same case scheduled on the item's list date (IST calendar day). Hearings
 * are expected newest-first; the first match with a non-empty purpose wins.
 * Null when there is no such hearing or it carries no purpose.
 */
export function pickItemPurpose(
  item: { caseId: string; listDate: string },
  hearings: ReadonlyArray<{ caseId: string; scheduledDate: Date | null; purpose: string | null }>,
): string | null {
  for (const h of hearings) {
    if (h.caseId !== item.caseId || !h.scheduledDate || !h.purpose) continue;
    if (IST_DAY.format(h.scheduledDate) === item.listDate) return h.purpose;
  }
  return null;
}
