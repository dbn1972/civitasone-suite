import { randomBytes } from "node:crypto";
export const LICENCE_STATUSES = ["active", "suspended", "cancelled", "expired"] as const;
export type LicenceStatus = (typeof LICENCE_STATUSES)[number];

export function canSuspend(status: string): boolean {
  return status === "active";
}

export function canCancel(status: string): boolean {
  return status === "active" || status === "suspended";
}

export function generateLicenceNumber(tenantShortCode: string, sequence: number): string {
  const year = new Date().getUTCFullYear();
  return `VLIC/${tenantShortCode}/${year}/${String(sequence).padStart(6, "0")}`;
}

export function generateVerificationCode(): string {
  return randomBytes(8).toString("hex").toUpperCase().substring(0, 8);
}

export function calculateLicenceFeeMinor(category: string): bigint {
  if (category === "food") return 200000n;
  if (category === "service") return 150000n;
  return 100000n;
}
