export const VIOLATION_STATUSES = [
  "reported",
  "notice_issued",
  "penalty_imposed",
  "removal_ordered",
  "removed",
  "closed",
] as const;

export type ViolationStatus = (typeof VIOLATION_STATUSES)[number];

export const VIOLATION_TYPES = [
  "unauthorized_hoarding",
  "expired_permit",
  "oversized",
  "unsafe_structure",
  "content_violation",
  "location_violation",
] as const;

export type ViolationType = (typeof VIOLATION_TYPES)[number];

const PENALTY_BASE_PAISE: Record<string, bigint> = {
  unauthorized_hoarding: 5000000n,
  expired_permit: 2500000n,
  oversized: 3000000n,
  unsafe_structure: 10000000n,
  content_violation: 2000000n,
  location_violation: 4000000n,
};

export function calculatePenaltyMinor(violationType: string): bigint {
  return PENALTY_BASE_PAISE[violationType] ?? 2000000n;
}

export function generateViolationNumber(tenantShortCode: string, sequence: number): string {
  const year = new Date().getUTCFullYear();
  return `ADVV/${tenantShortCode}/${year}/${String(sequence).padStart(6, "0")}`;
}

export function canIssueNotice(status: string): boolean {
  return status === "reported";
}

export function canImposePenalty(status: string): boolean {
  return status === "notice_issued" || status === "reported";
}

export function canOrderRemoval(status: string): boolean {
  return ["notice_issued", "penalty_imposed"].includes(status);
}

export function canRecordRemoval(status: string): boolean {
  return status === "removal_ordered";
}
