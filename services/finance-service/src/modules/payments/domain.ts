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
