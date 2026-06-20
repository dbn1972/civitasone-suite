export const APPLICATION_STATUSES = ["submitted", "under_review", "pending_docs", "approved", "rejected", "issued"] as const;
export type ApplicationStatus = typeof APPLICATION_STATUSES[number];

const TERMINAL: ApplicationStatus[] = ["approved", "rejected", "issued"];

export function isResolvedStatus(status: string): boolean {
  return TERMINAL.includes(status as ApplicationStatus);
}

export function computeDeadline(from: Date, maxDays: number): Date {
  const deadline = new Date(from);
  deadline.setDate(deadline.getDate() + maxDays);
  return deadline;
}

export function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isSlaBreached(createdAt: Date, maxDays: number, status: string, now = new Date()): boolean {
  if (isResolvedStatus(status)) return false;
  const deadline = computeDeadline(createdAt, maxDays);
  return now > deadline;
}

/** Throws if any service-required document type is missing from the submission. */
export function assertRequiredDocuments(required: string[], provided: string[]): void {
  const missing = required.filter((doc) => !provided.includes(doc));
  if (missing.length > 0) {
    throw new Error(`MISSING_DOCUMENTS: ${missing.join(", ")}`);
  }
}

/** Pre-signed S3 upload URL (60 min expiry) — binary never stored in DB. */
export function buildPresignedUploadUrl(tenantId: string, applicationId: string, docType: string): string {
  const expiry = Date.now() + 60 * 60 * 1000;
  return `https://s3.example.com/${tenantId}/applications/${applicationId}/${docType}?expires=${expiry}`;
}

export function assertStatusTransition(from: string, to: ApplicationStatus): void {
  const allowed: Record<string, ApplicationStatus[]> = {
    submitted:    ["under_review", "pending_docs", "rejected"],
    under_review: ["pending_docs", "approved", "rejected"],
    pending_docs: ["under_review", "rejected"],
    approved:     ["issued"],
    rejected:     [],
    issued:       [],
  };
  if (!allowed[from]?.includes(to)) {
    throw new Error(`INVALID_TRANSITION: cannot move from '${from}' to '${to}'`);
  }
}
