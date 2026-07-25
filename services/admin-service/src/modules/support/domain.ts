export const BREAK_GLASS_TTL_MS = 2 * 60 * 60 * 1000;

export function breakGlassExpiresAt(openedAt: Date): Date {
  return new Date(openedAt.getTime() + BREAK_GLASS_TTL_MS);
}

export function isBreakGlassExpired(expiresAt: Date, now = new Date()): boolean {
  return now >= expiresAt;
}


/** Error carrying an HTTP status + machine code for data-correction governance. */
export class DataCorrectionError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "DataCorrectionError";
  }
}

/**
 * Maker-checker for data corrections: the approver must differ from the
 * proposer. A support engineer can never approve their own correction.
 */
export function assertCorrectionApproverDistinct(proposerId: string, approverId: string): void {
  if (proposerId === approverId) {
    throw new DataCorrectionError(409, "MAKER_CHECKER_VIOLATION",
      "a data correction must be approved by someone other than its proposer");
  }
}

/** Only a still-pending correction can be approved or rejected. */
export function assertCorrectionPending(status: string): void {
  if (status !== "pending") {
    throw new DataCorrectionError(409, "NOT_PENDING",
      `data correction is '${status}', only 'pending' corrections can be decided`);
  }
}

/** A non-empty justification is mandatory to raise a correction. */
export function assertJustification(justification: string | null | undefined): void {
  if (!justification || justification.trim().length < 10) {
    throw new DataCorrectionError(422, "JUSTIFICATION_REQUIRED",
      "a data correction requires a justification of at least 10 characters");
  }
}
