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

/**
 * CRITICAL fix: previously nothing checked that a NOC's application had a
 * passing inspection at all — issueNoc's consumer never referenced the
 * inspections or applications modules for eligibility, only inserted a real
 * NOC (with a real number and verification code) for any applicationId
 * supplied. Requires at least one inspection with status "completed" and
 * recommendation "approve".
 */
export function checkNocEligibility(
  application: { status: string } | null,
  inspections: Array<{ status: string; recommendation: string | null }>,
): { eligible: boolean; reason: string } {
  if (!application) return { eligible: false, reason: "Application not found" };
  const hasApprovedInspection = inspections.some((i) => i.status === "completed" && i.recommendation === "approve");
  if (!hasApprovedInspection) {
    return { eligible: false, reason: "No completed inspection with an 'approve' recommendation exists for this application" };
  }
  return { eligible: true, reason: "" };
}
