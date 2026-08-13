import { randomBytes } from "node:crypto";

export const LICENCE_STATUSES = ["active", "suspended", "cancelled", "expired"] as const;
export type LicenceStatus = (typeof LICENCE_STATUSES)[number];

export const ACTION_TYPES = ["notice", "suspension", "cancellation", "restoration"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

const VALID_ACTION_TRANSITIONS: Record<string, LicenceStatus[]> = {
  active: ["suspended", "cancelled"],
  suspended: ["active", "cancelled"],
  cancelled: [],
  expired: [],
};

export function canPerformAction(currentStatus: string, targetStatus: LicenceStatus): boolean {
  return (VALID_ACTION_TRANSITIONS[currentStatus] ?? []).includes(targetStatus);
}

export function generateLicenceNumber(tenantShortCode: string, sequence: number): string {
  const year = new Date().getUTCFullYear();
  return `LIC/TRADE/${tenantShortCode}/${year}/${String(sequence).padStart(6, "0")}`;
}

export function generateVerificationCode(): string {
  return randomBytes(16).toString("hex").toUpperCase();
}

export function calculateValidUntil(issuedAt: Date, validityMonths: number = 12): Date {
  const d = new Date(issuedAt);
  d.setUTCMonth(d.getUTCMonth() + validityMonths);
  return d;
}

export function isExpired(validUntil: Date | null): boolean {
  if (!validUntil) return false;
  return new Date() > validUntil;
}
