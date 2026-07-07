/**
 * matching module — pure domain logic for three-way match verification.
 *
 * Three-Way Match compares:
 *   - Purchase Order (PO): ordered qty and rate
 *   - Goods Receipt Note (GRN): received qty
 *   - Invoice: billed qty and rate
 *
 * The match result is:
 *   - "matched" when all values agree within tolerance
 *   - "mismatch" when variance is detected but within reporting threshold
 *   - "exception" when variance exceeds tolerance → blocks payment authorization
 *
 * Validates: Requirements 14.10, 14.11
 */
import { DomainError } from "../../shared/domain.js";

/** Result status of a three-way match. */
export type MatchStatus = "matched" | "mismatch" | "exception";

/** Input for three-way match verification. */
export interface ThreeWayMatchInput {
  /** PO quantity ordered. */
  poQty: number;
  /** PO rate per unit in paise (bigint). */
  poRatePaise: bigint;
  /** GRN received quantity. */
  grnQty: number;
  /** Invoice billed quantity. */
  invoiceQty: number;
  /** Invoice rate per unit in paise (bigint). */
  invoiceRatePaise: bigint;
}

/** Tolerance configuration for three-way matching. */
export interface MatchTolerance {
  /** Percentage tolerance (e.g. 5 for 5%). Applied to qty and rate comparisons. */
  percentageTolerance: number;
  /** Absolute amount tolerance in paise. If configured, used instead of percentage for rate comparison. */
  absoluteAmountPaise?: bigint;
}

/** A single variance detail in the match result. */
export interface VarianceDetail {
  field: "qty" | "rate";
  comparison: string;
  expected: string;
  actual: string;
  variancePct: number;
  varianceAbsolute: string;
  exceedsTolerance: boolean;
}

/** Result of a three-way match evaluation. */
export interface ThreeWayMatchResult {
  /** Overall match status. */
  status: MatchStatus;
  /** Whether payment should be blocked (true for "exception" status). */
  paymentBlocked: boolean;
  /** Qty variance details. */
  qtyVariances: VarianceDetail[];
  /** Rate variance details. */
  rateVariances: VarianceDetail[];
  /** Summary of the match outcome. */
  summary: string;
}

/**
 * Computes the percentage variance between two values.
 * Returns 0 if the base is zero (no reference to compare against).
 */
function computeVariancePct(base: number, actual: number): number {
  if (base === 0) return actual === 0 ? 0 : 100;
  return Math.abs(((actual - base) / base) * 100);
}

/**
 * Computes the percentage variance between two bigint values.
 * Returns 0 if the base is zero.
 */
function computeBigintVariancePct(base: bigint, actual: bigint): number {
  if (base === 0n) return actual === 0n ? 0 : 100;
  // Use 10000 precision for percentage calculation
  const diff = actual > base ? actual - base : base - actual;
  return Number((diff * 10000n) / base) / 100;
}

/**
 * Performs three-way match verification on PO, GRN, and Invoice data.
 *
 * Comparison logic:
 *   - Qty check: PO qty vs GRN qty, PO qty vs Invoice qty
 *   - Rate check: PO rate vs Invoice rate
 *
 * @param input - The three documents' quantities and rates.
 * @param tolerance - Tolerance configuration for variance evaluation.
 * @returns ThreeWayMatchResult with status, variances, and payment block flag.
 * @throws DomainError if input quantities are negative.
 */
export function threeWayMatch(input: ThreeWayMatchInput, tolerance: MatchTolerance): ThreeWayMatchResult {
  const { poQty, poRatePaise, grnQty, invoiceQty, invoiceRatePaise } = input;

  if (poQty < 0 || grnQty < 0 || invoiceQty < 0) {
    throw new DomainError("INVALID_MATCH_INPUT", "Quantities cannot be negative");
  }
  if (poRatePaise < 0n || invoiceRatePaise < 0n) {
    throw new DomainError("INVALID_MATCH_INPUT", "Rates cannot be negative");
  }

  const qtyVariances: VarianceDetail[] = [];
  const rateVariances: VarianceDetail[] = [];
  let hasException = false;
  let hasMismatch = false;

  // ── Qty: PO vs GRN ───────────────────────────────────────────────────────
  const poGrnVariancePct = computeVariancePct(poQty, grnQty);
  const poGrnExceeds = poGrnVariancePct > tolerance.percentageTolerance;
  if (poQty !== grnQty) {
    hasMismatch = true;
    if (poGrnExceeds) hasException = true;
    qtyVariances.push({
      field: "qty",
      comparison: "PO vs GRN",
      expected: String(poQty),
      actual: String(grnQty),
      variancePct: Math.round(poGrnVariancePct * 100) / 100,
      varianceAbsolute: String(Math.abs(grnQty - poQty)),
      exceedsTolerance: poGrnExceeds,
    });
  }

  // ── Qty: PO vs Invoice ────────────────────────────────────────────────────
  const poInvQtyVariancePct = computeVariancePct(poQty, invoiceQty);
  const poInvQtyExceeds = poInvQtyVariancePct > tolerance.percentageTolerance;
  if (poQty !== invoiceQty) {
    hasMismatch = true;
    if (poInvQtyExceeds) hasException = true;
    qtyVariances.push({
      field: "qty",
      comparison: "PO vs Invoice",
      expected: String(poQty),
      actual: String(invoiceQty),
      variancePct: Math.round(poInvQtyVariancePct * 100) / 100,
      varianceAbsolute: String(Math.abs(invoiceQty - poQty)),
      exceedsTolerance: poInvQtyExceeds,
    });
  }

  // ── Rate: PO vs Invoice ───────────────────────────────────────────────────
  const rateVariancePct = computeBigintVariancePct(poRatePaise, invoiceRatePaise);
  let rateExceeds = rateVariancePct > tolerance.percentageTolerance;

  // If absolute tolerance is configured, also check against it
  if (tolerance.absoluteAmountPaise !== undefined) {
    const rateDiff = invoiceRatePaise > poRatePaise
      ? invoiceRatePaise - poRatePaise
      : poRatePaise - invoiceRatePaise;
    rateExceeds = rateDiff > tolerance.absoluteAmountPaise;
  }

  if (poRatePaise !== invoiceRatePaise) {
    hasMismatch = true;
    if (rateExceeds) hasException = true;
    const rateDiff = invoiceRatePaise > poRatePaise
      ? invoiceRatePaise - poRatePaise
      : poRatePaise - invoiceRatePaise;
    rateVariances.push({
      field: "rate",
      comparison: "PO vs Invoice",
      expected: String(poRatePaise),
      actual: String(invoiceRatePaise),
      variancePct: Math.round(rateVariancePct * 100) / 100,
      varianceAbsolute: String(rateDiff),
      exceedsTolerance: rateExceeds,
    });
  }

  // ── Determine overall status ──────────────────────────────────────────────
  let status: MatchStatus;
  if (hasException) {
    status = "exception";
  } else if (hasMismatch) {
    status = "mismatch";
  } else {
    status = "matched";
  }

  const paymentBlocked = status === "exception";

  let summary: string;
  if (status === "matched") {
    summary = "All documents match within tolerance — payment authorized";
  } else if (status === "mismatch") {
    summary = "Minor variances detected within tolerance — payment authorized";
  } else {
    summary = "Variance exceeds tolerance — payment blocked pending resolution";
  }

  return {
    status,
    paymentBlocked,
    qtyVariances,
    rateVariances,
    summary,
  };
}
