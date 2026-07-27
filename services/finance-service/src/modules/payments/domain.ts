/** Pure payments domain logic. */

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

/**
 * C4 FIX: Segregation of duties — the approver/payer (checker) must differ
 * from the creator (maker). Enforced on bill approve and payment initiate.
 */
export function assertDistinctMakerChecker(creatorId: string, approverId: string): void {
  if (creatorId && approverId && creatorId === approverId) {
    throw new DomainError(
      "MAKER_CHECKER_VIOLATION",
      "maker and checker must be different actors (self-approval rejected on money path)",
    );
  }
}

/** Bill must reference a PO and a GRN for 3-way match. */
export function assertThreeWayMatchPresent(poRef: string | null | undefined, grnRef: string | null | undefined): void {
  if (!poRef || !grnRef) {
    throw new DomainError(
      "THREE_WAY_MATCH_FAILED",
      "bill requires both po_ref and grn_ref for 3-way match"
    );
  }
}

/** Default 3-way-match tolerance (percent). Overridable via env at the gate. */
export const DEFAULT_THREE_WAY_TOLERANCE_PCT = 2;

export interface ThreeWayLegs {
  poAmountMinor: bigint;   // authoritative ordered value (from PO)
  grnAmountMinor: bigint;  // authoritative accepted/received value (from GRN)
  invoiceMinor: bigint;    // vendor invoice value being passed (bill gross)
}

/**
 * Overage of `value` above `cap` as a percentage (0 when within/under cap).
 *
 * REPORTING ONLY — do not use for the accept/reject decision. The BigInt
 * division truncates, so the result is quantised down to 0.01% steps and
 * systematically UNDER-reports. Use `exceedsTolerance()` to decide.
 */
function overagePct(value: bigint, cap: bigint): number {
  if (cap <= 0n) return value > 0n ? Number.POSITIVE_INFINITY : 0;
  if (value <= cap) return 0;
  return Number((value - cap) * 10000n / cap) / 100;
}

/**
 * Exact tolerance test on an absolute deviation: is `deviation` more than
 * `tolerancePct` of `cap`? Integer-only — no float, no truncating division.
 *
 *   exceed when deviation / cap > tolerancePct / 100
 *          <=>  deviation * 10000 > cap * (tolerancePct * 100)
 *
 * `tolerancePct` is scaled to basis points so fractional tolerances (2.5%)
 * stay exact. Boundary is EXCLUSIVE: exactly at tolerance is within tolerance.
 *
 * Exported so every money-path tolerance gate shares one implementation rather
 * than re-deriving it through `overagePct()`, which truncates (see below).
 */
export function deviationExceedsTolerance(deviation: bigint, cap: bigint, tolerancePct: number): boolean {
  if (cap <= 0n) return deviation > 0n;
  if (deviation <= 0n) return false;
  const toleranceBps = BigInt(Math.round(tolerancePct * 100)); // percent -> bps
  return deviation * 10000n > cap * toleranceBps;
}

/**
 * Exact tolerance test: is `value` more than `tolerancePct` above `cap`?
 *
 * WHY THIS EXISTS (money-path precision defect, found by mutation testing)
 * ----------------------------------------------------------------------
 * The decision used to be `overagePct(value, cap) > tolerancePct`. That routes a
 * money comparison through a truncating BigInt division and then a float, so the
 * measured overage is quantised DOWN to 0.01%-of-cap steps. The rounding is
 * always toward zero, so the error always favours ADMITTING overage — i.e.
 * paying more than was authorised. Measured examples:
 *
 *   PO Rs 1,000    GRN +Rs 20.01   -> reported 2.00% (true 2.001%) -> admitted at 2%
 *   PO Rs 1 crore  GRN +Rs 999.99  -> reported 0.00% (true 0.010%) -> admitted
 *                                     even at ZERO tolerance
 *
 * The quantum is `cap / 10000` paise, so the larger the PO the more money slips
 * through: Rs 999.99 on a Rs 1 crore order.
 *
 * This compares in exact integer arithmetic instead — no float, no truncation:
 *   reject when (value - cap) / cap > tolerancePct / 100
 *          <=>  (value - cap) * 10000 > cap * (tolerancePct * 100)
 *
 * `tolerancePct` is scaled to basis points so fractional tolerances (e.g. 2.5%)
 * remain exact. The boundary stays EXCLUSIVE: exactly at tolerance is allowed,
 * which is the pre-existing contract.
 */
function exceedsTolerance(value: bigint, cap: bigint, tolerancePct: number): boolean {
  if (cap <= 0n) return value > 0n;
  if (value <= cap) return false;
  return deviationExceedsTolerance(value - cap, cap, tolerancePct);
}

/**
 * R5 — real tri-leg PO↔GRN↔invoice reconciliation. Beyond merely requiring the
 * two reference strings, this enforces that the money reconciles:
 *   - all three legs must be positive (an unpriced PO/GRN cannot be matched),
 *   - the received value (GRN) may not exceed the ordered value (PO) beyond
 *     tolerance — you cannot accept more than was ordered,
 *   - the invoice may not exceed the accepted value (GRN) beyond tolerance —
 *     you pay for what was received, not what was billed,
 *   - the invoice may not exceed the ordered value (PO) beyond tolerance.
 * Under-billing (invoice < GRN) is always allowed (vendor billed less).
 */
export function assertThreeWayMatch(
  poRef: string | null | undefined,
  grnRef: string | null | undefined,
  legs: ThreeWayLegs,
  tolerancePct: number = DEFAULT_THREE_WAY_TOLERANCE_PCT,
): void {
  assertThreeWayMatchPresent(poRef, grnRef);
  const { poAmountMinor, grnAmountMinor, invoiceMinor } = legs;
  if (poAmountMinor <= 0n || grnAmountMinor <= 0n || invoiceMinor <= 0n) {
    throw new DomainError(
      "THREE_WAY_MATCH_FAILED",
      `po/grn/invoice amounts must all be positive to reconcile (po=${poAmountMinor} grn=${grnAmountMinor} invoice=${invoiceMinor})`,
    );
  }
  if (exceedsTolerance(grnAmountMinor, poAmountMinor, tolerancePct)) {
    throw new DomainError(
      "GRN_EXCEEDS_PO",
      `received value ${grnAmountMinor} paise exceeds ordered value ${poAmountMinor} paise by ~${overagePct(grnAmountMinor, poAmountMinor)}%, beyond the ${tolerancePct}% tolerance`,
    );
  }
  if (exceedsTolerance(invoiceMinor, grnAmountMinor, tolerancePct)) {
    throw new DomainError(
      "INVOICE_EXCEEDS_GRN",
      `invoice ${invoiceMinor} paise exceeds accepted/received value ${grnAmountMinor} paise by ~${overagePct(invoiceMinor, grnAmountMinor)}%, beyond the ${tolerancePct}% tolerance`,
    );
  }
  if (exceedsTolerance(invoiceMinor, poAmountMinor, tolerancePct)) {
    throw new DomainError(
      "INVOICE_EXCEEDS_PO",
      `invoice ${invoiceMinor} paise exceeds ordered value ${poAmountMinor} paise by ~${overagePct(invoiceMinor, poAmountMinor)}%, beyond the ${tolerancePct}% tolerance`,
    );
  }
}

const VALID_PAYMENT_MODES = new Set(["NEFT", "RTGS", "IMPS", "DBT", "PFMS", "cheque"]);

export function assertValidPaymentMode(mode: string): void {
  if (!VALID_PAYMENT_MODES.has(mode)) {
    throw new DomainError("INVALID_PAYMENT_MODE", `mode must be one of ${[...VALID_PAYMENT_MODES].join("|")}`);
  }
}

/** Payment can only be initiated once bill is in 'passed' status. */
export function assertBillPassed(status: string): void {
  if (status !== "passed") {
    throw new DomainError("BILL_NOT_PASSED", `payment requires bill.status=passed, got '${status}'`);
  }
}

const STAGE_TRANSITIONS: Record<string, string> = {
  section: "accounts",
  accounts: "pay",
};

export function nextStage(current: string): string {
  const next = STAGE_TRANSITIONS[current];
  if (!next) throw new DomainError("STAGE_TERMINAL", `bill is already at final stage '${current}'`);
  return next;
}
