export function assertDisbursementWithinApproved(approvedMinor: bigint, alreadyDisbursedMinor: bigint, newAmountMinor: bigint): void {
  if (alreadyDisbursedMinor + newAmountMinor > approvedMinor) {
    throw new Error(`DISBURSEMENT_EXCEEDS_APPROVED: approved=${approvedMinor} disbursed=${alreadyDisbursedMinor} new=${newAmountMinor}`);
  }
}

export const MAX_DISBURSEMENT_RETRIES = 3;

export function canRetryDisbursement(retryCount: number): boolean {
  return retryCount < MAX_DISBURSEMENT_RETRIES;
}

/**
 * GAP-GRANTS-INSTALLMENTS-03: a release is only permitted while the funding
 * scheme ("grant") is active. A suspended or closed scheme must fail closed
 * server-side (the UI also blocks the control). Pure + unit-testable with no
 * DB — the consumer calls this on the scheme row's status.
 */
const RELEASE_BLOCKED_SCHEME_STATUSES = new Set(["suspended", "closed"]);

export function isSchemeReleasable(schemeStatus: string | null | undefined): boolean {
  if (!schemeStatus) return true; // unknown scheme → fall through to other gates
  return !RELEASE_BLOCKED_SCHEME_STATUSES.has(schemeStatus);
}

/**
 * GAP-GRANTS-INSTALLMENTS-03: the release-eligibility status of the grant an installment belongs to,
 * combining the application and its funding scheme. Anything other than "active" must not be released:
 *   cancelled  - the application was withdrawn / rejected / cancelled
 *   suspended  - the application is suspended, or the scheme is suspended / closed (same rule as isSchemeReleasable)
 *   completed  - fully paid out
 * Pure; shared by the installments read-model (so the UI can disable Release) and the consumer (authority).
 */
export type InstallmentGrantStatus = "active" | "completed" | "suspended" | "cancelled";

export function effectiveGrantStatus(applicationStatus: string, schemeStatus: string | null | undefined): InstallmentGrantStatus {
  if (applicationStatus === "withdrawn" || applicationStatus === "rejected" || applicationStatus === "cancelled") return "cancelled";
  if (applicationStatus === "completed") return "completed";
  if (applicationStatus === "suspended" || !isSchemeReleasable(schemeStatus)) return "suspended";
  return "active";
}
