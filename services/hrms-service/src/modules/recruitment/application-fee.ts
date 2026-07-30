/**
 * Application fee assessment / exemption / payment (checklist R-RA-0099) — pure.
 *
 * The vacancy carries the fee (fees_minor, paise). A candidate is either EXEMPT
 * (reserved category / PwD / ex-serviceman / a zero-fee vacancy) or must PAY.
 * Payment can be recorded manually (offline challan/DD reference — common in
 * government) or, when the online payment GATEWAY is wired (feature flag), taken
 * online. The gateway itself is an EXTERNAL integration and is deferred behind a
 * seam — we never fake an online charge. Money is bigint paise throughout.
 */

export const FEE_STATUSES = ["pending", "exempt", "paid", "refunded"] as const;
export type FeeStatus = (typeof FEE_STATUSES)[number];

export const PAYMENT_PROVIDERS = ["manual", "gateway", "none"] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

/**
 * Categories that are fee-exempt by default in Indian government recruitment.
 * Tenants may override the set; this is the safe default.
 */
export const DEFAULT_EXEMPT_CATEGORIES = ["SC", "ST", "PWD", "EXSM", "FEMALE"] as const;

export interface FeeAssessment {
  status: Extract<FeeStatus, "pending" | "exempt">;
  amountMinor: bigint;
  exemptionReason: string | null;
}

/**
 * Assess the fee for an application. Returns an EXEMPT assessment (amount 0) when
 * the vacancy has no fee, or when the candidate's category is exempt AND that
 * category has been VERIFIED (a self-declared category alone never grants an
 * exemption — that would be a fee-bypass). Otherwise a PENDING assessment for the
 * vacancy fee. Never does money arithmetic beyond passing the vacancy amount
 * through (bigint paise). The exempt-category set is caller-supplied (from the
 * vacancy/tenant policy), defaulting to the government-standard set.
 */
export function assessFee(
  vacancyFeeMinor: bigint | null | undefined,
  opts: { category?: string | null; categoryVerified?: boolean; exemptCategories?: readonly string[] },
): FeeAssessment {
  const fee = vacancyFeeMinor ?? 0n;
  if (fee <= 0n) return { status: "exempt", amountMinor: 0n, exemptionReason: "no_fee_for_vacancy" };
  const exempt = (opts.exemptCategories ?? DEFAULT_EXEMPT_CATEGORIES).map((c) => c.toUpperCase());
  const cat = opts.category ? opts.category.trim().toUpperCase() : null;
  if (cat && exempt.includes(cat)) {
    // Exemption only when the category claim is verified; otherwise the fee is
    // payable and the candidate can produce proof to have it waived.
    if (opts.categoryVerified === true) {
      return { status: "exempt", amountMinor: 0n, exemptionReason: `category_${cat}` };
    }
    return { status: "pending", amountMinor: fee, exemptionReason: null };
  }
  return { status: "pending", amountMinor: fee, exemptionReason: null };
}

/** Whether online payment can be taken (gateway feature flag). Default OFF. */
export function gatewayEnabled(env: Record<string, string | undefined>): boolean {
  return env.FEATURE_FEE_GATEWAY_ENABLED === "true";
}

/**
 * Validate a manual (offline) payment recording. A manual payment MUST carry a
 * reference (challan / DD / UTR number) — the auditable proof of receipt.
 */
export function validateManualPayment(input: { paymentRef?: string | undefined }): string[] {
  const errors: string[] = [];
  if (!input.paymentRef || input.paymentRef.trim().length === 0) {
    errors.push("a paymentRef (challan/DD/UTR number) is required to record a manual payment");
  }
  return errors;
}
