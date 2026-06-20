export function assertUcExpenditureWithinDisbursed(disbursedMinor: bigint, utilisedMinor: bigint): void {
  if (utilisedMinor > disbursedMinor) {
    throw new Error(`UC_EXPENDITURE_EXCEEDS_DISBURSED: disbursed=${disbursedMinor} utilised=${utilisedMinor}`);
  }
}
