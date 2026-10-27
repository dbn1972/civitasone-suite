export const APPLICATION_STATUSES = ["draft", "submitted", "under_review", "approved", "rejected", "withdrawn"] as const;
export type ApplicationStatus = typeof APPLICATION_STATUSES[number];

export function assertTransition(from: string, to: ApplicationStatus): void {
  const allowed: Record<string, ApplicationStatus[]> = {
    draft:        ["submitted", "withdrawn"],
    submitted:    ["under_review", "withdrawn"],
    under_review: ["approved", "rejected"],
    approved:     [],
    rejected:     [],
    withdrawn:    [],
  };
  if (!allowed[from]?.includes(to)) {
    throw new Error(`INVALID_TRANSITION: cannot move from '${from}' to '${to}'`);
  }
}

/**
 * GAP-GRANTS-APPLICATIONS-DETAIL-05: the web reviewer picker sends "identity_user:<uuid>" (the opaque ref
 * documented on grant_scores.reviewer_ref). Returns the bare user id so it can be compared with submitted_by;
 * a legacy free-text label is passed through unchanged (and so never equals a user id).
 */
export function reviewerUserId(reviewerRef: string): string {
  return reviewerRef.trim().replace(/^identity_user:/, "");
}

/** Separation of duties: the person reviewing an application must not be the one who submitted it. */
export function isReviewerSubmitter(reviewerRef: string, submittedBy: string | null | undefined): boolean {
  return !!submittedBy && reviewerUserId(reviewerRef).toLowerCase() === submittedBy.toLowerCase();
}
