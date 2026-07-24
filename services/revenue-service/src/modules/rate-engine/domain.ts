/**
 * Rate Engine — pure deterministic compute for municipal revenue.
 *
 * Given a rate head, base value, as-of date, and exemptions, computes:
 *  { principal, rebate, penalty, interest, net }
 *
 * All amounts are bigint paise — never floating point.
 * Results are snapshot-stored so any past bill re-derives byte-for-byte.
 *
 * _Requirements: SVC-136_
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type SlabType = "flat" | "band" | "ad_valorem";
export type InterestType = "simple" | "compound";
export type RoundingMode = "round_half_up" | "floor" | "ceil";

export interface RateSlab {
  id: string;
  rateHeadId: string;
  slabType: SlabType;
  /** Lower bound (inclusive) for band slabs. null for flat. */
  bandFrom: bigint | null;
  /** Upper bound (exclusive) for band slabs. null for flat or open-ended. */
  bandTo: bigint | null;
  /** Rate value: paise for flat, basis points (bps) for ad_valorem, paise per unit for band */
  rateValue: bigint;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo: string | null;
  isActive: boolean;
}

export interface PenaltyRule {
  id: string;
  rateHeadId: string;
  interestType: InterestType;
  /** Annual interest rate in basis points (e.g. 1200 = 12%) */
  annualRateBps: number;
  /** Days after due date before penalty starts */
  graceDays: number;
  /** Max months interest can accrue (cap). null = no cap */
  capMonths: number | null;
  /** Rounding mode for interest calculation */
  roundingMode: RoundingMode;
  isActive: boolean;
}

export interface RebateRule {
  id: string;
  rateHeadId: string;
  rebateType: "early_payment" | "category";
  /** Discount in basis points (e.g. 500 = 5%) */
  discountBps: number;
  /** Days before due date within which rebate applies. null for category-based */
  validUntilDaysBeforeDue: number | null;
  isActive: boolean;
}

export interface ComputeInput {
  rateHeadId: string;
  baseValue: bigint;
  asOfDate: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
  exemptions: string[];
  /** Date the payment is being made (for rebate eligibility check) */
  paymentDate?: string;
}

export interface ComputeResult {
  principal: bigint;
  rebate: bigint;
  penalty: bigint;
  interest: bigint;
  net: bigint;
  /** Snapshot of inputs + intermediate values for re-derivation */
  snapshot: ComputeSnapshot;
}

export interface ComputeSnapshot {
  rateHeadId: string;
  baseValue: string; // bigint as string for JSON serialization
  asOfDate: string;
  dueDate: string;
  paymentDate: string | null;
  exemptions: string[];
  slabUsed: string | null; // slab ID
  penaltyRuleUsed: string | null;
  rebateRuleUsed: string | null;
  overdueDays: number;
  interestMonths: number;
  principal: string;
  rebate: string;
  penalty: string;
  interest: string;
  net: string;
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;
const BPS_DIVISOR = 10_000n;
const MONTHS_PER_YEAR = 12;

// ── Pure Functions ────────────────────────────────────────────────────────────

/**
 * Lookup the effective rate slab for a given date from a set of slabs.
 */
export function lookupEffectiveSlab(slabs: RateSlab[], rateHeadId: string, asOfDate: string): RateSlab | null {
  const dateMs = new Date(asOfDate).getTime();
  const matching = slabs.filter((s) => {
    if (!s.isActive || s.rateHeadId !== rateHeadId) return false;
    const from = new Date(s.effectiveFrom).getTime();
    const to = s.effectiveTo ? new Date(s.effectiveTo).getTime() : Infinity;
    return dateMs >= from && dateMs < to;
  });
  // Return first matching slab (for flat) or allow caller to iterate bands
  return matching[0] ?? null;
}

/**
 * Lookup all effective slabs for band-based computation.
 */
export function lookupEffectiveSlabs(slabs: RateSlab[], rateHeadId: string, asOfDate: string): RateSlab[] {
  const dateMs = new Date(asOfDate).getTime();
  return slabs.filter((s) => {
    if (!s.isActive || s.rateHeadId !== rateHeadId) return false;
    const from = new Date(s.effectiveFrom).getTime();
    const to = s.effectiveTo ? new Date(s.effectiveTo).getTime() : Infinity;
    return dateMs >= from && dateMs < to;
  });
}

/**
 * Compute principal from the base value and applicable rate slab(s).
 */
export function computePrincipal(baseValue: bigint, slabs: RateSlab[]): { principal: bigint; slabUsed: string | null } {
  if (slabs.length === 0) {
    throw new DomainError("NO_EFFECTIVE_SLAB", "No effective rate slab found for the given date");
  }

  const slab = slabs[0]!;

  switch (slab.slabType) {
    case "flat":
      return { principal: slab.rateValue, slabUsed: slab.id };

    case "ad_valorem": {
      // rateValue is in bps: principal = baseValue * rateBps / 10000
      const principal = (baseValue * slab.rateValue) / BPS_DIVISOR;
      return { principal, slabUsed: slab.id };
    }

    case "band": {
      // Sum across all band slabs
      let total = 0n;
      let usedId = slab.id;
      const sorted = [...slabs]
        .filter((s) => s.slabType === "band")
        .sort((a, b) => Number((a.bandFrom ?? 0n) - (b.bandFrom ?? 0n)));

      for (const band of sorted) {
        const from = band.bandFrom ?? 0n;
        const to = band.bandTo ?? baseValue;
        if (baseValue <= from) break;
        const taxable = (baseValue < to ? baseValue : to) - from;
        total += (taxable * band.rateValue) / BPS_DIVISOR;
        usedId = band.id;
      }
      return { principal: total, slabUsed: usedId };
    }

    default:
      throw new DomainError("INVALID_SLAB_TYPE", `Unknown slab type: ${slab.slabType}`);
  }
}

/**
 * Calculate days between two dates.
 */
export function daysBetween(dateA: string, dateB: string): number {
  const a = Date.parse(`${dateA}T00:00:00Z`);
  const b = Date.parse(`${dateB}T00:00:00Z`);
  return Math.round((a - b) / MS_PER_DAY);
}

/**
 * Compute penalty/interest on overdue amounts using the penalty rule.
 */
export function computeInterest(
  principal: bigint,
  dueDate: string,
  asOfDate: string,
  rule: PenaltyRule,
): { interest: bigint; overdueDays: number; interestMonths: number } {
  const totalDaysLate = daysBetween(asOfDate, dueDate);
  const overdueDays = Math.max(0, totalDaysLate - rule.graceDays);

  if (overdueDays <= 0) {
    return { interest: 0n, overdueDays: 0, interestMonths: 0 };
  }

  // Convert to months (30-day convention for municipal tax)
  let interestMonths = Math.ceil(overdueDays / 30);
  if (rule.capMonths !== null && interestMonths > rule.capMonths) {
    interestMonths = rule.capMonths;
  }

  const monthlyRateBps = Math.round(rule.annualRateBps / MONTHS_PER_YEAR);
  let interest: bigint;

  if (rule.interestType === "simple") {
    // Simple interest: P * r * t / 10000
    interest = (principal * BigInt(monthlyRateBps) * BigInt(interestMonths)) / BPS_DIVISOR;
  } else {
    // Compound interest: P * ((1 + r/10000)^t - 1)
    // Use iterative multiplication to avoid floating point
    let amount = principal * BPS_DIVISOR; // scale up
    for (let i = 0; i < interestMonths; i++) {
      amount = (amount * (BPS_DIVISOR + BigInt(monthlyRateBps))) / BPS_DIVISOR;
    }
    interest = amount / BPS_DIVISOR - principal;
  }

  // Apply rounding
  interest = applyRounding(interest, rule.roundingMode);

  return { interest, overdueDays, interestMonths };
}

/**
 * Compute rebate on the principal if eligible.
 */
export function computeRebate(
  principal: bigint,
  dueDate: string,
  paymentDate: string | null,
  rules: RebateRule[],
): { rebate: bigint; ruleUsed: string | null } {
  if (!paymentDate || rules.length === 0) {
    return { rebate: 0n, ruleUsed: null };
  }

  const daysBeforeDue = daysBetween(dueDate, paymentDate);

  for (const rule of rules) {
    if (!rule.isActive) continue;

    if (rule.rebateType === "early_payment") {
      if (rule.validUntilDaysBeforeDue !== null && daysBeforeDue >= rule.validUntilDaysBeforeDue) {
        const rebate = (principal * BigInt(rule.discountBps)) / BPS_DIVISOR;
        return { rebate, ruleUsed: rule.id };
      }
    }
    // category-based rebates would check exemptions list — simplified for now
  }

  return { rebate: 0n, ruleUsed: null };
}

/**
 * Apply rounding to a bigint amount.
 */
export function applyRounding(amount: bigint, mode: RoundingMode): bigint {
  // Round to nearest rupee (100 paise)
  const rupees = amount / 100n;
  const remainder = amount % 100n;

  switch (mode) {
    case "floor":
      return rupees * 100n;
    case "ceil":
      return remainder > 0n ? (rupees + 1n) * 100n : rupees * 100n;
    case "round_half_up":
      return remainder >= 50n ? (rupees + 1n) * 100n : rupees * 100n;
    default:
      return amount;
  }
}

/**
 * Assert maker-checker: the checker must be a different user than the maker.
 */
export function assertMakerChecker(makerUserId: string, checkerUserId: string): void {
  if (makerUserId === checkerUserId) {
    throw new DomainError(
      "MAKER_CHECKER_VIOLATION",
      "Checker cannot be the same person as the maker (separation of duties)",
    );
  }
}

/**
 * Full compute: given rate head config, base value, dates, exemptions → tax breakdown.
 *
 * This is the core deterministic function that must produce byte-identical results
 * when re-run with the same snapshot inputs.
 */
export function compute(
  slabs: RateSlab[],
  penaltyRules: PenaltyRule[],
  rebateRules: RebateRule[],
  input: ComputeInput,
): ComputeResult {
  // 1. Find effective slabs for the rate head
  const effectiveSlabs = lookupEffectiveSlabs(slabs, input.rateHeadId, input.asOfDate);
  if (effectiveSlabs.length === 0) {
    throw new DomainError("NO_EFFECTIVE_SLAB", "No effective rate slab found for the given date and rate head");
  }

  // 2. Compute principal from slab
  const { principal, slabUsed } = computePrincipal(input.baseValue, effectiveSlabs);

  // 3. Compute rebate (if payment is early)
  const activeRebates = rebateRules.filter((r) => r.isActive && r.rateHeadId === input.rateHeadId);
  const { rebate, ruleUsed: rebateRuleUsed } = computeRebate(
    principal,
    input.dueDate,
    input.paymentDate ?? null,
    activeRebates,
  );

  // 4. Compute penalty/interest (if overdue)
  const activePenaltyRule = penaltyRules.find((r) => r.isActive && r.rateHeadId === input.rateHeadId);
  let interest = 0n;
  let penalty = 0n;
  let overdueDays = 0;
  let interestMonths = 0;
  let penaltyRuleUsed: string | null = null;

  if (activePenaltyRule) {
    const result = computeInterest(principal, input.dueDate, input.asOfDate, activePenaltyRule);
    interest = result.interest;
    overdueDays = result.overdueDays;
    interestMonths = result.interestMonths;
    penalty = interest; // In municipal context, penalty IS the interest on overdue
    penaltyRuleUsed = activePenaltyRule.id;
  }

  // 5. Net = principal - rebate + penalty
  const net = principal - rebate + penalty;

  const snapshot: ComputeSnapshot = {
    rateHeadId: input.rateHeadId,
    baseValue: input.baseValue.toString(),
    asOfDate: input.asOfDate,
    dueDate: input.dueDate,
    paymentDate: input.paymentDate ?? null,
    exemptions: input.exemptions,
    slabUsed,
    penaltyRuleUsed,
    rebateRuleUsed,
    overdueDays,
    interestMonths,
    principal: principal.toString(),
    rebate: rebate.toString(),
    penalty: penalty.toString(),
    interest: interest.toString(),
    net: net.toString(),
  };

  return { principal, rebate, penalty, interest, net, snapshot };
}
