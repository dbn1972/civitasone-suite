/** Pure payments domain logic. */

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
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

/** Overage of `value` above `cap` as a percentage (0 when within/under cap). */
function overagePct(value: bigint, cap: bigint): number {
  if (cap <= 0n) return value > 0n ? Number.POSITIVE_INFINITY : 0;
  if (value <= cap) return 0;
  return Number((value - cap) * 10000n / cap) / 100;
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
  if (overagePct(grnAmountMinor, poAmountMinor) > tolerancePct) {
    throw new DomainError(
      "GRN_EXCEEDS_PO",
      `received value ${grnAmountMinor} paise exceeds ordered value ${poAmountMinor} paise beyond ${tolerancePct}% tolerance`,
    );
  }
  if (overagePct(invoiceMinor, grnAmountMinor) > tolerancePct) {
    throw new DomainError(
      "INVOICE_EXCEEDS_GRN",
      `invoice ${invoiceMinor} paise exceeds accepted/received value ${grnAmountMinor} paise beyond ${tolerancePct}% tolerance`,
    );
  }
  if (overagePct(invoiceMinor, poAmountMinor) > tolerancePct) {
    throw new DomainError(
      "INVOICE_EXCEEDS_PO",
      `invoice ${invoiceMinor} paise exceeds ordered value ${poAmountMinor} paise beyond ${tolerancePct}% tolerance`,
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
