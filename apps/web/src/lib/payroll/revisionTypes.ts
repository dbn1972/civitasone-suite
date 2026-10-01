/**
 * GAP-PAYROLL-SALARY-REVISIONS-01: the create form and the history list each
 * declared their own revision_type vocabulary and the two had silently
 * diverged -- CreateSalaryRevisionForm.tsx could only submit
 * annual_increment/promotion/correction/fitment, while page.tsx's label map
 * only knew annual_increment/promotion/special/pay_commission/
 * market_correction. A form submission of "correction" or "fitment" printed
 * as the raw code in the history table, and the "Pay Commission" stat
 * counted a value the form could never produce.
 *
 * This is the real, backend-verified set: payroll-service's own zod
 * validator (services/payroll-service/src/modules/payroll/validators.ts)
 * is `z.enum(["annual_increment", "promotion", "correction", "fitment"])` --
 * special/pay_commission/market_correction are not, and have never been,
 * accepted by POST /v1/payroll/salary-revisions. One shared source now
 * drives both the form's <select> options and the list's display labels.
 *
 * PR #1756 review (H1): the DB CHECK on payroll_salary_revisions.revision_type
 * (migration 0005) used to allow ONLY the legacy set below, so every
 * "correction"/"fitment" submit was 202-accepted and then rejected by the
 * consumer INSERT. payroll-service migration 0050 widens the CHECK to the
 * union. Legacy rows (special/pay_commission/market_correction) are still
 * DB-valid and still rendered with a readable label, but never offered by
 * the form.
 */
export const REVISION_TYPES = ["annual_increment", "promotion", "correction", "fitment"] as const;
export type RevisionType = (typeof REVISION_TYPES)[number];

/** Message keys in the `salaryRevisions` / `createSalaryRevisionForm` namespaces, one per REVISION_TYPES member. */
export const REVISION_TYPE_LIST_LABEL_KEYS: Record<RevisionType, string> = {
  annual_increment: "revisionTypeAnnualIncrement",
  promotion: "revisionTypePromotion",
  correction: "revisionTypeCorrection",
  fitment: "revisionTypeFitment",
};

export const REVISION_TYPE_FORM_LABEL_KEYS: Record<RevisionType, string> = {
  annual_increment: "revisionTypeAnnualIncrementOption",
  promotion: "revisionTypePromotionOption",
  correction: "revisionTypeCorrectionOption",
  fitment: "revisionTypeFitmentOption",
};

export function isRevisionType(value: string): value is RevisionType {
  return (REVISION_TYPES as readonly string[]).includes(value);
}

/** DB-valid legacy codes the form no longer submits but historic rows may carry. */
export const LEGACY_REVISION_TYPE_LIST_LABEL_KEYS: Record<string, string> = {
  special: "revisionTypeSpecial",
  pay_commission: "revisionTypePayCommission",
  market_correction: "revisionTypeMarketCorrection",
};

/** `salaryRevisions` message key for any known revision_type (current or legacy), else undefined. */
export function revisionTypeListLabelKey(value: string): string | undefined {
  if (isRevisionType(value)) return REVISION_TYPE_LIST_LABEL_KEYS[value];
  return Object.prototype.hasOwnProperty.call(LEGACY_REVISION_TYPE_LIST_LABEL_KEYS, value)
    ? LEGACY_REVISION_TYPE_LIST_LABEL_KEYS[value]
    : undefined;
}
