export const RENEWAL_TYPES = ["renewal", "amendment", "duplicate", "surrender"] as const;
export type RenewalType = (typeof RENEWAL_TYPES)[number];

export const RENEWAL_STATUSES = ["submitted", "under_review", "approved", "rejected"] as const;
export type RenewalStatus = (typeof RENEWAL_STATUSES)[number];

export function calculateRenewalFeeMinor(renewalType: string): bigint {
  switch (renewalType) {
    case "renewal":
      return 75000n; // Rs 750
    case "amendment":
      return 50000n; // Rs 500
    case "duplicate":
      return 25000n; // Rs 250
    case "surrender":
      return 0n;
    default:
      return 50000n;
  }
}

export function calculateNewValidUntil(previousValidUntil: Date | null, extensionMonths: number = 12): Date {
  const base = previousValidUntil ?? new Date();
  const start = base > new Date() ? base : new Date();
  const d = new Date(start);
  d.setUTCMonth(d.getUTCMonth() + extensionMonths);
  return d;
}

export function canRequestRenewal(permitStatus: string, renewalType: string): boolean {
  if (renewalType === "surrender") return permitStatus === "active";
  return permitStatus === "active" || permitStatus === "expired";
}
