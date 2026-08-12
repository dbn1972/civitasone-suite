export const RENEWAL_TYPES = ["renewal", "zone_transfer", "cancellation", "surrender"] as const;
export type RenewalType = (typeof RENEWAL_TYPES)[number];

export const LIFECYCLE_STATUSES = ["submitted", "under_review", "approved", "rejected"] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

export function calculateRenewalFeeMinor(renewalType: string): bigint {
  if (renewalType === "renewal") return 75000n;
  if (renewalType === "zone_transfer") return 50000n;
  return 0n;
}

export function canDecideLifecycle(status: string): boolean {
  return status === "submitted" || status === "under_review";
}
