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
 * CRITICAL fix (original): previously nothing checked that a NOC's
 * application had a passing inspection at all — issueNoc's consumer never
 * referenced the inspections or applications modules for eligibility, only
 * inserted a real NOC (with a real number and verification code) for any
 * applicationId supplied. Requires the MOST RECENT inspection to have status
 * "completed" and recommendation "approve".
 *
 * Follow-up fix (independent review of #825): the original check used
 * inspections.some(...), matching ANY historical inspection rather than the
 * most recent one. A building whose first inspection passed but whose later
 * re-inspection came back "reject" would still pass this check because of
 * the stale earlier approval — nothing prevented scheduling a second
 * inspection for an application that already had one approved (a separate,
 * still-unbuilt duplicate-inspection-prevention feature). `inspections` is
 * expected pre-sorted newest-first (inspections/repo.ts's findByApplicationId
 * already does `.orderBy(desc(createdAt))`), so checking only inspections[0]
 * closes this without needing a schema or query change.
 */
export function checkNocEligibility(
  application: { status: string } | null,
  inspections: Array<{ status: string; recommendation: string | null }>,
): { eligible: boolean; reason: string } {
  if (!application) return { eligible: false, reason: "Application not found" };
  const mostRecent = inspections[0];
  const hasApprovedInspection = mostRecent?.status === "completed" && mostRecent.recommendation === "approve";
  if (!hasApprovedInspection) {
    return { eligible: false, reason: "The most recent inspection for this application is not a completed 'approve' recommendation" };
  }
  return { eligible: true, reason: "" };
}
