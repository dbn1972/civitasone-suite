/**
 * accruals/domain.ts — Pure domain logic for points accrual.
 * Transaction types: purchase, bonus, referral, promotion, adjustment.
 * Money stored as bigint paise.
 */

export type TxType = "purchase" | "bonus" | "referral" | "promotion" | "adjustment";

export const VALID_TX_TYPES: TxType[] = ["purchase", "bonus", "referral", "promotion", "adjustment"];

/**
 * Calculate points earned from a purchase amount.
 * @param amountPaise - Transaction amount in paise (bigint)
 * @param earnRatio - Points per 100 paise (bigint). E.g. 1 point per ₹1 = 100.
 * @returns Points to award (bigint)
 */
export function calculatePoints(amountPaise: bigint, earnRatio: bigint): bigint {
  if (amountPaise <= BigInt(0)) return BigInt(0);
  if (earnRatio <= BigInt(0)) return BigInt(0);
  // earnRatio = points earned per 100 paise (i.e. per ₹1)
  return (amountPaise * earnRatio) / BigInt(10000);
}

/**
 * Compute the expiry date for points based on program expiry policy.
 * @param accrualDate - When points were earned
 * @param expiryDays - Number of days until expiry (null = never expires)
 */
export function computeExpiryDate(accrualDate: Date, expiryDays: number | null | undefined): Date | null {
  if (expiryDays == null || expiryDays <= 0) return null;
  const expiry = new Date(accrualDate.getTime());
  expiry.setDate(expiry.getDate() + expiryDays);
  return expiry;
}

/**
 * Recalculate balance from a set of accruals and redemptions.
 */
export function recalculateBalance(
  totalAccrued: bigint,
  totalRedeemed: bigint,
): bigint {
  const balance = totalAccrued - totalRedeemed;
  return balance < BigInt(0) ? BigInt(0) : balance;
}

/**
 * Validate accrual input.
 */
export function validateAccrual(input: {
  points: bigint;
  source: string;
  txType: string;
}): { valid: boolean; error?: string } {
  if (input.points <= BigInt(0)) {
    return { valid: false, error: "points must be positive" };
  }
  if (!input.source || input.source.trim().length === 0) {
    return { valid: false, error: "source is required" };
  }
  if (!VALID_TX_TYPES.includes(input.txType as TxType)) {
    return { valid: false, error: `txType must be one of: ${VALID_TX_TYPES.join(", ")}` };
  }
  return { valid: true };
}

/**
 * Check if points have expired.
 */
export function isExpired(expiresAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  return now > expiresAt;
}
