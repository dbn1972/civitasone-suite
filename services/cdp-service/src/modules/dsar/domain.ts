/**
 * dsar/domain.ts — CDP-011 pure DSAR rules: allowed values and the status machine.
 */

export const DSAR_REQUEST_TYPES = ["access", "erasure", "rectification", "portability"] as const;
export type DsarRequestType = (typeof DSAR_REQUEST_TYPES)[number];

export const DSAR_STATUSES = ["pending", "in_progress", "completed", "rejected"] as const;
export type DsarStatus = (typeof DSAR_STATUSES)[number];

/**
 * Which statuses may still be discharged. `completed` and `rejected` are terminal:
 * re-completing would emit a second purge event and double-count the SLA.
 */
const COMPLETABLE: readonly DsarStatus[] = ["pending", "in_progress"];

export function isCompletable(status: string): boolean {
  return (COMPLETABLE as readonly string[]).includes(status);
}

/**
 * Only an erasure or rectification request changes the profile that downstream
 * audiences hold, so only those need a purge fan-out. Access and portability are
 * read-only disclosures.
 */
export function requiresDownstreamPurge(requestType: string): boolean {
  return requestType === "erasure" || requestType === "rectification";
}
