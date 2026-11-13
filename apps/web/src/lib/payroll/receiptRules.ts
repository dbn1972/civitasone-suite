import {
  REIMBURSEMENT_RECEIPT_REQUIRED_CATEGORIES, RECEIPT_MODES, effectiveReceiptRule, receiptRequiredFor, selfDeclarationAllowedFor,
  type ReceiptCategoryRule, type ReceiptMode, type ReceiptPolicy,
} from "@civitasone/types";

/**
 * GAP-PAYROLL-REIMBURSEMENTS-03: reimbursement receipt rules shared by the
 * claim form. Mirrors payroll-service (modules/payroll/fin03-domain.ts):
 * PDF / JPEG / PNG, at most 10 MB each and 5 per claim.
 */
export const RECEIPT_MAX_FILES = 5;
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
export const RECEIPT_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export const RECEIPT_ACCEPT = RECEIPT_TYPES.join(",");

/**
 * Categories whose claims need supporting documents (medical bills, LTA
 * tickets, travel tickets / vouchers): the SAME list payroll-service enforces
 * (route + consumer), shared from @civitasone/types so they cannot drift.
 */
export const RECEIPT_REQUIRED_CATEGORIES: readonly string[] = REIMBURSEMENT_RECEIPT_REQUIRED_CATEGORIES;

export function receiptRequired(category: string): boolean {
  return RECEIPT_REQUIRED_CATEGORIES.includes(category);
}

export type ReceiptProblem = "type" | "size" | "limit" | null;

/** Why a picked file cannot be attached, or null when it can. */
export function receiptProblem(file: { type: string; size: number }, alreadyAttached: number): ReceiptProblem {
  if (alreadyAttached >= RECEIPT_MAX_FILES) return "limit";
  if (!(RECEIPT_TYPES as readonly string[]).includes(file.type)) return "type";
  if (file.size <= 0 || file.size > RECEIPT_MAX_BYTES) return "size";
  return null;
}

// ─── Per-tenant receipt policy (GET /v1/payroll/reimbursement-receipt-policy) ───

/**
 * The tenant's rule per category as the API reports it (explicit overrides AND
 * defaults, so every category is present). null = could not be read: callers
 * fall back to the built-in default (medical / LTA / travel need a receipt),
 * which is also what payroll-service enforces when nothing is configured.
 */
export function receiptPolicyFromApi(payload: unknown): ReceiptPolicy | null {
  const cats = (payload as { categories?: unknown } | null)?.categories;
  if (!cats || typeof cats !== "object" || Array.isArray(cats)) return null;
  const out: ReceiptPolicy["categories"] = {};
  for (const [category, raw] of Object.entries(cats as Record<string, unknown>)) {
    const r = raw as { mode?: unknown; thresholdMinor?: unknown; selfDeclarationUpToMinor?: unknown } | null;
    if (!r || !(RECEIPT_MODES as readonly string[]).includes(r.mode as string)) return null;
    out[category] = {
      mode: r.mode as ReceiptMode,
      thresholdMinor: typeof r.thresholdMinor === "number" ? r.thresholdMinor : null,
      selfDeclarationUpToMinor: typeof r.selfDeclarationUpToMinor === "number" ? r.selfDeclarationUpToMinor : null,
    };
  }
  return { categories: out };
}

export type ReceiptNeed = {
  rule: ReceiptCategoryRule;
  /** A receipt is needed for a claim of this amount. */
  required: boolean;
  /** ... and a signed self-declaration may stand in for it at this amount. */
  selfDeclarationAllowed: boolean;
};

/** What the rule in force asks of a claim of `amountMinor` (0 = amount not entered yet). */
export function receiptNeed(policy: ReceiptPolicy | null | undefined, category: string, amountMinor: number): ReceiptNeed {
  const rule = effectiveReceiptRule(policy, category);
  return { rule, required: receiptRequiredFor(rule, amountMinor), selfDeclarationAllowed: selfDeclarationAllowedFor(rule, amountMinor) };
}
