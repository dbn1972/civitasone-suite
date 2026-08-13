import { randomBytes } from "node:crypto";

export const NOC_STATUSES = ["issued", "active", "suspended", "revoked", "expired"] as const;
export type NocStatus = (typeof NOC_STATUSES)[number];

export function generateNocNumber(
  tenantShortCode: string,
  year: number,
  sequence: number,
): string {
  return `FNOC/${tenantShortCode}/${year}/${String(sequence).padStart(6, "0")}`;
}

export function generateVerificationCode(): string {
  return randomBytes(16).toString("hex");
}

export function isExpired(validUntil: string | Date | null): boolean {
  if (!validUntil) return false;
  return new Date(validUntil) < new Date();
}

export function calculateValidUntil(validFrom: Date, durationYears: number = 3): Date {
  const d = new Date(validFrom);
  d.setFullYear(d.getFullYear() + durationYears);
  return d;
}
