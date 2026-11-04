/**
 * T-STAT review of PR #2449 (SF4 / SF5 / SF7): what approving a run needs
 * reviewed, from GET /v1/payroll/runs/:id/approval-review (payroll-service).
 * Money is integer paise as digit strings.
 */
export type ApprovalReview = {
  runId: string;
  zeroBasic: Array<{ employeeId: string; employeeNo: string }>;
  arrears: {
    totalMinor: string;
    thresholdBps: number;
    employees: Array<{ employeeId: string; employeeNo: string; arrearsMinor: string; regularGrossMinor: string; requiresReview: boolean }>;
  };
};

/** Server codes that mean "this run needs the review fields before approval". */
export const APPROVAL_REVIEW_CODES = new Set(["ZERO_BASIC_SLIPS", "ARREARS_REVIEW_REQUIRED"]);

export function approvalReviewUrl(runId: string): string {
  return `/api/proxy/v1/payroll/runs/${runId}/approval-review`;
}

/** Loads the review; null when it cannot be read (never throws). */
export async function loadApprovalReview(runId: string): Promise<ApprovalReview | null> {
  try {
    const res = await fetch(approvalReviewUrl(runId));
    if (!res.ok) return null;
    const body = (await res.json()) as ApprovalReview | null;
    return body && Array.isArray(body.zeroBasic) && body.arrears && Array.isArray(body.arrears.employees) ? body : null;
  } catch {
    return null;
  }
}
