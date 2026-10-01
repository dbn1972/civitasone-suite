/**
 * Reimbursement claim categories -- the stable backend codes
 * (payroll-service validators.ts createReimbursementBody / the
 * payroll_reimbursements.category CHECK constraint). Never translated; only
 * used to look up the display label's message key in the
 * `createReimbursementForm` namespace (UX-017 pattern).
 *
 * GAP-PAYROLL-REIMBURSEMENTS-04: shared by the claim form AND the claims
 * table, which used to print the raw code ("lta").
 */
export const REIMBURSEMENT_CATEGORIES = ["medical", "travel", "lta", "food", "telephone", "internet", "fuel", "other"] as const;
export type ReimbursementCategory = (typeof REIMBURSEMENT_CATEGORIES)[number];

/** Message key (createReimbursementForm namespace) for a category, or null for an unknown code. */
export function reimbursementCategoryKey(code: string): string | null {
  return (REIMBURSEMENT_CATEGORIES as readonly string[]).includes(code)
    ? `category${code.charAt(0).toUpperCase()}${code.slice(1)}`
    : null;
}
