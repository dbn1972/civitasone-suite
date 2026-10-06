/**
 * Shared display labels for the procurement planning surface, so the list,
 * detail and new-plan pages render identical, human copy instead of raw enum
 * values. Source of truth for:
 *   - GAP-PROCUREMENT-PLANNING-03  (plan status label parity list vs detail)
 *   - GAP-PROCUREMENT-PLANNING-NEW-05 (procurement-method labels, GeM etc.)
 *
 * The keys mirror the backend enums exactly:
 *   plan status:  services/procurement-service/src/modules/planning/domain.ts
 *                 PlanStatus = draft | pending | approved | rejected
 *   method:       PROCUREMENT_METHODS = direct_purchase | gem | limited_tender
 *                 | advertised_tender | single_tender
 */

/** Annual-plan maker-checker status labels. */
export const PLAN_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending: "Pending Approval",
  approved: "Approved",
  rejected: "Rejected",
};

/** Procurement method labels (GFR 2017 / GeM). */
export const METHOD_LABELS: Record<string, string> = {
  direct_purchase: "Direct purchase",
  gem: "GeM",
  limited_tender: "Limited tender",
  advertised_tender: "Advertised tender",
  single_tender: "Single tender",
};

/** Label a plan status, falling back to the raw value if unknown. */
export function planStatusLabel(status: string): string {
  return PLAN_STATUS_LABELS[status] ?? status;
}

/**
 * Label a procurement method, falling back to a de-underscored form if the
 * backend ever adds a method this map does not yet know about.
 */
export function methodLabel(method: string): string {
  return METHOD_LABELS[method] ?? method.replace(/_/g, " ");
}
