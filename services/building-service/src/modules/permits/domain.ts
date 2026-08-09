import { randomBytes } from "node:crypto";

export const PERMIT_STATUSES = ["active", "suspended", "cancelled", "expired"] as const;
export type PermitStatus = (typeof PERMIT_STATUSES)[number];

const VALID_TRANSITIONS: Record<string, PermitStatus[]> = {
  active: ["suspended", "cancelled"],
  suspended: ["active", "cancelled"],
  cancelled: [],
  expired: [],
};

export function canPerformAction(currentStatus: string, targetStatus: PermitStatus): boolean {
  return (VALID_TRANSITIONS[currentStatus] ?? []).includes(targetStatus);
}

export function generatePermitNumber(tenantShortCode: string, sequence: number): string {
  const year = new Date().getUTCFullYear();
  return `PERM/BLDG/${tenantShortCode}/${year}/${String(sequence).padStart(6, "0")}`;
}

export function generateVerificationCode(): string {
  return randomBytes(16).toString("hex").toUpperCase();
}

export function calculateValidUntil(issuedAt: Date, validityMonths: number = 24): Date {
  const d = new Date(issuedAt);
  d.setUTCMonth(d.getUTCMonth() + validityMonths);
  return d;
}
