import { HttpError } from "../../shared/context.js";

/**
 * GAP-ASSETS-VERIFICATION-07: a physical-verification session moves
 * draft -> submitted -> approved, one way. Items may only be recorded while it
 * is still a draft; submit needs a draft; approve needs a submitted session.
 * Anything else is a 409 so a completed (approved) record cannot be altered.
 */
export type VerificationAction = "add-item" | "submit" | "approve";

const ALLOWED_FROM: Record<VerificationAction, string> = {
  "add-item": "draft",
  submit: "draft",
  approve: "submitted",
};

export function assertVerificationTransition(status: string, action: VerificationAction): void {
  if (status !== ALLOWED_FROM[action]) {
    throw new HttpError(
      409,
      "INVALID_STATE",
      `cannot ${action} on a verification session that is ${status} (needs ${ALLOWED_FROM[action]})`,
    );
  }
}
