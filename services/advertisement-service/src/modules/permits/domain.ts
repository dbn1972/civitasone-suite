import { randomBytes } from "node:crypto";

export const PERMIT_STATUSES = [
  "issued",
  "active",
  "suspended",
  "expired",
  "cancelled",
] as const;

export type PermitStatus = (typeof PERMIT_STATUSES)[number];

export const PERMIT_TRANSITIONS: Record<string, PermitStatus[]> = {
  issued: ["active", "cancelled"],
  active: ["suspended", "expired", "cancelled"],
  suspended: ["active", "cancelled"],
  expired: [],
  cancelled: [],
};

export const RENEWAL_TYPES = [
  "renewal",
  "creative_change",
  "size_change",
  "location_change",
  "removal",
] as const;

export function generatePermitNumber(tenantShortCode: string, sequence: number): string {
  const year = new Date().getUTCFullYear();
  return `ADVP/${tenantShortCode}/${year}/${String(sequence).padStart(6, "0")}`;
}

export function generateVerificationCode(): string {
  return randomBytes(16).toString("hex");
}

export function isExpired(validUntil: string | null | undefined): boolean {
  if (!validUntil) return false;
  return new Date(validUntil) < new Date();
}

// Added for the POST /v1/advertisement/permits/:id/renew pre-accept check.
// Previously that route only checked the permit existed, with no state
// gate at all — a cancelled or expired permit could be "renewed" (its
// validUntil silently extended) exactly like an active one. Renewal is only
// meaningful for a permit still in force; suspended/expired/cancelled must
// be excluded (a suspended permit's suspension must be resolved first, not
// bypassed by renewing around it).
export function canRenew(status: string): boolean {
  return status === "issued" || status === "active";
}
