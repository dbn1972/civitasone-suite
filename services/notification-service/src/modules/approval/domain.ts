/**
 * Approval domain logic — state machine for template approval workflow.
 *
 * Valid transitions:
 *   draft → in_review (submit)
 *   in_review → approved (approve)
 *   in_review → draft (reject — returned for rework)
 *   approved → published (publish)
 *
 * Maker-checker constraint: the actor who submitted cannot be the one who approves.
 */

export type ApprovalStatus = "draft" | "in_review" | "approved" | "rejected" | "published";

export type TransitionResult =
  | { ok: true; newStatus: ApprovalStatus }
  | { ok: false; error: string };

const VALID_TRANSITIONS: Record<string, ApprovalStatus[]> = {
  draft: ["in_review"],
  in_review: ["approved", "draft"],
  approved: ["published"],
};

/**
 * Attempt to transition a template's approval status.
 * Returns the new status on success, or an error message on failure.
 */
export function transitionState(
  currentStatus: string,
  targetAction: "submit" | "approve" | "reject" | "publish",
): TransitionResult {
  const targetStatus = actionToTarget(targetAction);
  const allowed = VALID_TRANSITIONS[currentStatus];

  if (!allowed) {
    return { ok: false, error: `Cannot transition from status '${currentStatus}'` };
  }

  if (!allowed.includes(targetStatus)) {
    return { ok: false, error: `Invalid transition: '${currentStatus}' → '${targetStatus}' (via ${targetAction})` };
  }

  return { ok: true, newStatus: targetStatus };
}

/**
 * Validate maker-checker constraint.
 * The submitter (maker) cannot be the same person as the approver (checker).
 * Returns true if the constraint is satisfied (different actors).
 */
export function validateMakerChecker(submittedBy: string, approverId: string): boolean {
  return submittedBy !== approverId;
}

/**
 * Determine if a template can be used for delivery.
 * Only templates with status "published" may be delivered.
 */
export function canDeliver(status: string): boolean {
  return status === "published";
}

function actionToTarget(action: "submit" | "approve" | "reject" | "publish"): ApprovalStatus {
  switch (action) {
    case "submit": return "in_review";
    case "approve": return "approved";
    case "reject": return "draft";
    case "publish": return "published";
  }
}
