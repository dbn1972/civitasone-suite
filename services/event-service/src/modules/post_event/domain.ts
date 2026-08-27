export const DEPOSIT_DECISIONS = ["full_refund", "partial_refund", "forfeited"] as const;
export type DepositDecision = (typeof DEPOSIT_DECISIONS)[number];

export function canDecideDeposit(inspection: { depositDecision: string | null }): boolean {
  return inspection.depositDecision === null;
}

/**
 * A post-event inspection previously had no check at all that the permit it
 * references exists, is still valid (not revoked), or that the event has
 * actually happened yet (validUntil in the past). This let an inspection — and
 * therefore a deposit decision — be recorded against any permitId, including
 * one for an event that hasn't happened, or one already revoked.
 */
export function checkInspectionEligibility(
  permit: { status: string; validUntil: Date | string | null } | null,
): { eligible: boolean; reason: string } {
  if (!permit) return { eligible: false, reason: "Permit not found" };
  if (permit.status === "revoked") return { eligible: false, reason: "Permit has been revoked" };
  if (permit.validUntil && new Date(permit.validUntil) > new Date()) {
    return { eligible: false, reason: "Event has not concluded yet (permit validUntil is in the future)" };
  }
  return { eligible: true, reason: "" };
}

/**
 * CRITICAL fix, the money bug: refundMinor was previously entirely
 * client-supplied with no relationship to the depositMinor actually collected
 * on the application — "forfeited" with any refundMinor was accepted,
 * "full_refund" with refundMinor omitted stored 0 (the opposite of a full
 * refund), and "partial_refund" could exceed the original deposit. This
 * computes the actual, authoritative refund amount server-side; the caller's
 * `requestedRefundMinor` is consulted only for "partial_refund", and even then
 * is bounds-checked against what was really collected.
 */
export function computeRefundMinor(
  decision: string,
  depositMinor: bigint,
  requestedRefundMinor: bigint | undefined,
): bigint {
  if (decision === "forfeited") return 0n;
  if (decision === "full_refund") return depositMinor;
  if (decision === "partial_refund") {
    if (requestedRefundMinor === undefined) {
      throw new Error("partial_refund requires refundMinor");
    }
    if (requestedRefundMinor < 0n || requestedRefundMinor > depositMinor) {
      throw new Error(`refundMinor must be between 0 and the collected deposit (${depositMinor})`);
    }
    return requestedRefundMinor;
  }
  throw new Error(`unknown deposit decision '${decision}'`);
}
