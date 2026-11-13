import { REIMBURSEMENT_RECEIPT_REQUIRED_CATEGORIES } from "./index.js";

/**
 * Per-tenant receipt rule for reimbursement claims. ONE implementation shared by
 * payroll-service (route + consumer) and the web claim form so they cannot drift.
 *
 * A tenant may set, per claim category:
 *   - mode "always"       a receipt is required for every claim;
 *   - mode "never"        no receipt is ever required;
 *   - mode "above_amount" a receipt is required when the amount is MORE than
 *                         thresholdMinor (an amount equal to the threshold needs none).
 * and, when a receipt would otherwise be required, whether a signed
 * self-declaration may stand in for it (amount <= selfDeclarationUpToMinor).
 *
 * No policy, or a category the policy does not list, means the built-in default,
 * which is exactly the behaviour before this setting existed: medical, LTA and
 * travel need a receipt, every other category does not.
 */
export const REIMBURSEMENT_CATEGORY_CODES = ["medical", "travel", "lta", "food", "telephone", "internet", "fuel", "other"] as const;
export type ReimbursementCategoryCode = (typeof REIMBURSEMENT_CATEGORY_CODES)[number];

export const RECEIPT_MODES = ["always", "never", "above_amount"] as const;
export type ReceiptMode = (typeof RECEIPT_MODES)[number];

export interface ReceiptCategoryRule {
  mode: ReceiptMode;
  /** above_amount only: a receipt is required when amountMinor > thresholdMinor. Paise. */
  thresholdMinor?: number | null | undefined;
  /** A signed self-declaration may replace the receipt when amountMinor <= this. Paise. null/absent = not allowed. */
  selfDeclarationUpToMinor?: number | null | undefined;
}

export interface ReceiptPolicy {
  categories: Partial<Record<string, ReceiptCategoryRule>>;
}

/** How a stored claim was supported. */
export type ReceiptBasis = "receipt" | "self_declaration" | "not_required";

/** The built-in rule for a category (today's behaviour). */
export function defaultReceiptRule(category: string): ReceiptCategoryRule {
  return { mode: REIMBURSEMENT_RECEIPT_REQUIRED_CATEGORIES.includes(category) ? "always" : "never" };
}

/** The rule in force for a category: the tenant's, else the default. */
export function effectiveReceiptRule(policy: ReceiptPolicy | null | undefined, category: string): ReceiptCategoryRule {
  return policy?.categories?.[category] ?? defaultReceiptRule(category);
}

export function receiptRequiredFor(rule: ReceiptCategoryRule, amountMinor: number): boolean {
  if (rule.mode === "always") return true;
  if (rule.mode === "above_amount") return amountMinor > (rule.thresholdMinor ?? 0);
  return false;
}

/** May a signed self-declaration stand in for the receipt for a claim of this amount? */
export function selfDeclarationAllowedFor(rule: ReceiptCategoryRule, amountMinor: number): boolean {
  return rule.mode !== "never" && rule.selfDeclarationUpToMinor != null && amountMinor <= rule.selfDeclarationUpToMinor;
}

export type ReceiptDecision =
  | { ok: true; basis: ReceiptBasis; rule: ReceiptCategoryRule }
  | { ok: false; code: "RECEIPT_REQUIRED"; rule: ReceiptCategoryRule; selfDeclarationAllowed: boolean };

/**
 * Pure decision for one claim. A receipt always wins; otherwise a self-declaration
 * is honoured only where the rule allows it for this amount; otherwise, if a
 * receipt is required, the claim is refused.
 */
export function evaluateReceiptRule(
  policy: ReceiptPolicy | null | undefined,
  category: string,
  amountMinor: number,
  receiptCount: number,
  selfDeclared: boolean,
): ReceiptDecision {
  const rule = effectiveReceiptRule(policy, category);
  if (receiptCount > 0) return { ok: true, basis: "receipt", rule };
  if (!receiptRequiredFor(rule, amountMinor)) return { ok: true, basis: "not_required", rule };
  const allowed = selfDeclarationAllowedFor(rule, amountMinor);
  if (selfDeclared && allowed) return { ok: true, basis: "self_declaration", rule };
  return { ok: false, code: "RECEIPT_REQUIRED", rule, selfDeclarationAllowed: allowed };
}

const rupees = (minor: number): string => `Rs ${(minor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Plain-English statement of the rule that applied, for the 422 message and audit trail. */
export function describeReceiptRule(rule: ReceiptCategoryRule): string {
  const base =
    rule.mode === "always" ? "a receipt is required for every claim in this category"
    : rule.mode === "above_amount" ? `a receipt is required for claims above ${rupees(rule.thresholdMinor ?? 0)}`
    : "no receipt is required for this category";
  if (rule.mode !== "never" && rule.selfDeclarationUpToMinor != null) {
    return `${base}; a signed self-declaration is accepted instead for claims up to ${rupees(rule.selfDeclarationUpToMinor)}`;
  }
  return base;
}

/** Why a policy is invalid, or null. Used by the save route; the DB only checks its outer shape. */
export function receiptPolicyIssue(policy: ReceiptPolicy): { path: string; message: string } | null {
  for (const [category, rule] of Object.entries(policy.categories)) {
    if (!rule) continue;
    const at = `categories.${category}`;
    if (!(REIMBURSEMENT_CATEGORY_CODES as readonly string[]).includes(category)) return { path: at, message: `unknown claim category ${category}` };
    if (!(RECEIPT_MODES as readonly string[]).includes(rule.mode)) return { path: `${at}.mode`, message: "mode must be always, never or above_amount" };
    const t = rule.thresholdMinor;
    if (rule.mode === "above_amount" && !(Number.isInteger(t) && (t as number) > 0)) {
      return { path: `${at}.thresholdMinor`, message: "an amount above which a receipt is required must be a positive whole number of paise" };
    }
    if (rule.mode !== "above_amount" && t != null) return { path: `${at}.thresholdMinor`, message: "thresholdMinor applies only to the above_amount mode" };
    const s = rule.selfDeclarationUpToMinor;
    if (s != null && !(Number.isInteger(s) && s > 0)) return { path: `${at}.selfDeclarationUpToMinor`, message: "the self-declaration limit must be a positive whole number of paise" };
    if (s != null && rule.mode === "never") return { path: `${at}.selfDeclarationUpToMinor`, message: "a self-declaration limit is meaningless when no receipt is ever required" };
    if (s != null && rule.mode === "above_amount" && s <= (t as number)) {
      return { path: `${at}.selfDeclarationUpToMinor`, message: "the self-declaration limit must exceed the amount above which a receipt is required (below it no receipt is needed anyway)" };
    }
  }
  return null;
}
