export function assertDisbursementWithinApproved(approvedMinor: bigint, alreadyDisbursedMinor: bigint, newAmountMinor: bigint): void {
  if (alreadyDisbursedMinor + newAmountMinor > approvedMinor) {
    throw new Error(`DISBURSEMENT_EXCEEDS_APPROVED: approved=${approvedMinor} disbursed=${alreadyDisbursedMinor} new=${newAmountMinor}`);
  }
}

export const MAX_DISBURSEMENT_RETRIES = 3;

export function canRetryDisbursement(retryCount: number): boolean {
  return retryCount < MAX_DISBURSEMENT_RETRIES;
}
