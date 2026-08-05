import type { CommissionRuleRow } from "./schema.js";

/**
 * Compute commission amount from a deal value using matching rules.
 * Returns amount in minor units (paise/cents).
 */
export function computeCommission(
  dealValueMinor: bigint,
  rule: Pick<CommissionRuleRow, "rateType" | "rateValue">,
): bigint {
  if (rule.rateType === "fixed") {
    return rule.rateValue;
  }
  // Percentage: rateValue is basis points (e.g. 500 = 5%)
  // commission = dealValue * rateValue / 10000
  return (dealValueMinor * rule.rateValue) / 10000n;
}

/**
 * Derive the period string (YYYY-MM) from a date.
 */
export function derivePeriod(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
