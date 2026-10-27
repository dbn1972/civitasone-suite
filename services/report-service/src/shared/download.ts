/**
 * UAT owner decision #17 (GAP-REPORTS-LIST-04): report download links expire in
 * 15 minutes. Nothing stores a presigned URL; the object key is deterministic, so
 * a fresh short-lived link is minted on every (owner-checked, audited) download.
 */
export const DOWNLOAD_LINK_TTL_SECONDS = 15 * 60;

/** Storage key a rendered job is written to (render consumer) and read from (download route). */
export function jobStorageKey(tenantId: string, jobId: string, format: string): string {
  return `reports/${tenantId}/${jobId}.${format}`;
}
