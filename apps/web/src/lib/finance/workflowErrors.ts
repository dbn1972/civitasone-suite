import { errorCodeFromResponse, errorMessageFromResponse } from "@/lib/api/browserClient";
import type { MessageKind } from "@/lib/messages";

/**
 * Finance workflow error codes (maker != checker, cheque / vendor / audit-para state machines) ->
 * keys under `financeWorkflowErrors` in messages/{en,hi}.json. A code listed here gets its own
 * plain-language copy; anything else falls back to the catalogued generic message, so a raw
 * server code or status never reaches a clerk.
 */
export const WORKFLOW_ERROR_KEYS = {
  MAKER_CHECKER_VIOLATION: "makerChecker",
  VENDOR_NOT_PENDING: "vendorNotPending",
  VENDOR_NOT_APPROVED: "vendorNotApproved",
  BANK_CHANGE_PENDING: "bankChangePending",
  BANK_CHANGE_NOT_PENDING: "bankChangeNotPending",
  BANK_CHANGE_REQUIRES_APPROVAL: "bankChangeRequiresApproval",
  ILLEGAL_TRANSITION: "illegalTransition",
  INSTRUMENT_STALE: "instrumentStale",
  INSTRUMENT_NOT_STALE: "instrumentNotStale",
  NO_BANK_ACCOUNT: "noBankAccount",
  DUPLICATE_PAN: "duplicatePan",
  VERSION_CONFLICT: "versionConflict",
} as const;

export type WorkflowErrorKey = (typeof WORKFLOW_ERROR_KEYS)[keyof typeof WORKFLOW_ERROR_KEYS];

/** Pure lookup, unit-tested: the i18n key for a known code, else null. */
export function workflowErrorKey(code: string | null | undefined): WorkflowErrorKey | null {
  if (!code) return null;
  return (WORKFLOW_ERROR_KEYS as Record<string, WorkflowErrorKey>)[code] ?? null;
}

/**
 * Plain-language message for a failed workflow call. `t` is the `financeWorkflowErrors` translator.
 */
export async function workflowErrorMessage(
  res: Response,
  t: (key: WorkflowErrorKey) => string,
  fallbackKind: MessageKind,
  area: string,
): Promise<string> {
  const key = workflowErrorKey(await errorCodeFromResponse(res));
  if (key) return t(key);
  return errorMessageFromResponse(res, res.status === 403 ? "forbidden" : fallbackKind, area);
}
