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
