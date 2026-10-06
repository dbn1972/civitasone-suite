/**
 * Canonical utilisation-certificate status vocabulary for the web read model.
 *
 * grant-service writes a UC validation outcome as one of `submitted | verified
 * | rejected | pending` on the list read model (utilisation/queries.ts
 * mapUcStatus) but the single-grant detail read model surfaces the raw
 * `validationStatus` column, which uses "validated" for the approved state
 * (see GrantDetailTables Verify → POST .../validate { status: "validated" } and
 * uc-validation). Both spellings mean "this UC has been checked and accepted",
 * so summary counts and the per-row "already verified" test must treat them
 * identically — otherwise /grants/utilization undercounts a UC that the grant
 * page just verified. GAP-GRANTS-DETAIL-05.
 */
export const UC_VERIFIED_STATUSES = ["verified", "validated"] as const;

/** True when a UC status counts as verified/validated (checked and accepted). */
export function isUcVerified(status: string | null | undefined): boolean {
  return status != null && (UC_VERIFIED_STATUSES as readonly string[]).includes(status);
}
