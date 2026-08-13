import { randomBytes } from "node:crypto";

export const CERT_TYPES = ["commencement", "completion", "occupancy"] as const;
export type CertType = (typeof CERT_TYPES)[number];

export const RENEWAL_TYPES = ["renewal", "extension", "amendment"] as const;
export type RenewalType = (typeof RENEWAL_TYPES)[number];

export const RENEWAL_STATUSES = ["submitted", "under_review", "approved", "rejected"] as const;
export type RenewalStatus = (typeof RENEWAL_STATUSES)[number];

export function calculateRenewalFeeMinor(renewalType: string): bigint {
  switch (renewalType) {
    case "renewal": return 200000n;
    case "extension": return 150000n;
    case "amendment": return 100000n;
    default: return 100000n;
  }
}

export function calculateNewValidUntil(previousValidUntil: Date | null, extensionMonths: number = 24): Date {
  const base = previousValidUntil ?? new Date();
  const start = base > new Date() ? base : new Date();
  const d = new Date(start);
  d.setUTCMonth(d.getUTCMonth() + extensionMonths);
  return d;
}

export function generateCertificateVerificationCode(): string {
  return randomBytes(16).toString("hex").toUpperCase();
}

export function canRequestRenewal(permitStatus: string): boolean {
  return permitStatus === "active" || permitStatus === "expired";
}
