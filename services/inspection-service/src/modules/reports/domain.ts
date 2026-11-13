/**
 * reports module — pure domain rules for the inspection-report lifecycle.
 *
 *   draft ──submit──▶ submitted ──approve──▶ approved
 *                         │
 *                         └──reject──▶ rejected ──submit (resubmit)──▶ submitted
 *
 * A rejected report is revisable (observations may be added) and can be submitted again.
 */

export type ReportStatus = "draft" | "submitted" | "approved" | "rejected";

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

const TRANSITIONS: Record<ReportStatus, readonly ReportStatus[]> = {
  draft: ["submitted"],
  submitted: ["approved", "rejected"],
  approved: [],
  rejected: ["submitted"],
};

/**
 * The makers an approver must differ from: inspector, author and submitter. `submitted_by` (0034) is
 * authoritative; rows submitted before it fall back to `updated_by`, which only submit writes after create.
 */
export function reportMakers(report: {
  inspectorId: string; createdBy: string; updatedBy: string; submittedBy: string | null;
}): string[] {
  return [report.inspectorId, report.createdBy, report.submittedBy ?? report.updatedBy];
}

/** Statuses a report may still receive observations in. */
export const OBSERVABLE_STATUSES: readonly string[] = ["draft", "submitted", "rejected"];

/** Statuses from which the inspector may (re)submit a report. */
export const SUBMITTABLE_STATUSES: readonly string[] = ["draft", "rejected"];

/** A rejection must say why; the bounds are shared by the route and the consumer. */
export const REJECTION_REASON_MIN = 5;
export const REJECTION_REASON_MAX = 2000;

/** @throws {DomainError} INVALID_REPORT_TRANSITION when `current → target` is not allowed. */
export function assertValidReportTransition(current: string, target: ReportStatus): void {
  const allowed = TRANSITIONS[current as ReportStatus] ?? [];
  if (!allowed.includes(target)) {
    throw new DomainError(
      "INVALID_REPORT_TRANSITION",
      `Cannot transition inspection report from '${current}' to '${target}'`,
    );
  }
}

/**
 * Maker-checker on approval: the approver must not be the report's inspector, author or submitter.
 * @throws {DomainError} MAKER_CHECKER_VIOLATION
 */
export function assertMakerCheckerForReportApproval(
  makers: ReadonlyArray<string | null | undefined>,
  approverId: string,
): void {
  if (makers.some((m) => m != null && m === approverId)) {
    throw new DomainError(
      "MAKER_CHECKER_VIOLATION",
      "Inspection report cannot be approved by its inspector, author or submitter (maker-checker enforcement)",
    );
  }
}

/**
 * Maker-checker on rejection: the approving officer must not be the report's inspector, author or
 * submitter, so nobody can reject (or approve) their own report.
 * @throws {DomainError} MAKER_CHECKER_VIOLATION
 */
export function assertMakerCheckerForReportRejection(
  makers: ReadonlyArray<string | null | undefined>,
  rejecterId: string,
): void {
  if (makers.some((m) => m != null && m === rejecterId)) {
    throw new DomainError(
      "MAKER_CHECKER_VIOLATION",
      "Inspection report cannot be rejected by its inspector, author or submitter (maker-checker enforcement)",
    );
  }
}

/** @throws {DomainError} REJECTION_REASON_REQUIRED when the reason is blank or too short. */
export function assertRejectionReason(reason: string | null | undefined): string {
  const trimmed = (reason ?? "").trim();
  if (trimmed.length < REJECTION_REASON_MIN) {
    throw new DomainError("REJECTION_REASON_REQUIRED", `A rejection reason of at least ${REJECTION_REASON_MIN} characters is required`);
  }
  return trimmed;
}
