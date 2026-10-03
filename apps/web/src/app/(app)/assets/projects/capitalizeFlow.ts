/**
 * GAP-ASSETS-PROJECTS-09: plain-language copy for the capitalisation endpoints' known error codes
 * (asset-service enterprise routes). Anything not listed falls back to the generic catalogue message --
 * the code itself is never shown.
 */
export type CapitalizeMode = "capitalize" | "approve" | "reject" | "repost";

const MESSAGES: Record<string, string> = {
  MAKER_CHECKER: "A different asset administrator must approve this capitalization. You requested it, so you cannot approve it.",
  AUC_NOT_PENDING: "This project is not awaiting approval any more. Refresh the list to see its current status.",
  AUC_NOT_CAPITALIZABLE: "This project has already been submitted or capitalized. Refresh the list to see its current status.",
  FORBIDDEN: "Only an asset administrator can approve or reject a capitalization.",
};

export function aucCapitalizeErrorMessage(code: string | null): string | null {
  return code && Object.prototype.hasOwnProperty.call(MESSAGES, code) ? (MESSAGES[code] as string) : null;
}
