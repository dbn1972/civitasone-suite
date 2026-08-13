export const RENEWAL_TYPES = ["renewal", "amendment"] as const;
export type RenewalType = (typeof RENEWAL_TYPES)[number];

export const RENEWAL_STATUSES = ["requested", "under_review", "approved", "rejected"] as const;
export type RenewalStatus = (typeof RENEWAL_STATUSES)[number];

const RENEWAL_FEE_PAISE: Record<RenewalType, bigint> = {
  renewal: 150000n,
  amendment: 75000n,
};

export function calculateRenewalFee(renewalType: RenewalType): bigint {
  return RENEWAL_FEE_PAISE[renewalType] ?? 150000n;
}

export function calculateNewValidUntil(currentValidUntil: Date, extensionYears: number = 3): Date {
  const d = new Date(currentValidUntil);
  d.setFullYear(d.getFullYear() + extensionYears);
  return d;
}

export function canRequestRenewal(nocStatus: string, validUntil: string | Date | null): boolean {
  if (nocStatus === "revoked" || nocStatus === "suspended") return false;
  if (!validUntil) return false;
  return true;
}
