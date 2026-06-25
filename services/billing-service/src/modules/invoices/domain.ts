export function shouldSkipInvoiceGeneration(govtExempt: boolean): boolean {
  return govtExempt;
}

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "DomainError";
  }
}

export type InvoiceStatus =
  | "draft"
  | "issued"
  | "partially_paid"
  | "paid"
  | "overdue"
  | "waived"
  | "cancelled";

export type LineKind = "line" | "tax" | "charge";

export interface LineItemInput {
  description: string;
  amountMinor: number; // paise per unit
  quantity?: number;
  kind?: LineKind;
}

/**
 * Maker-checker threshold (paise). Issue/cancel of a bill at or above this value
 * requires a separate approver (maker != checker). Default ₹1,00,000.
 * Government billing: significant-value state changes are dual-controlled.
 */
export const APPROVAL_THRESHOLD_MINOR = BigInt(
  process.env.BILLING_APPROVAL_THRESHOLD_MINOR ?? "10000000",
);

export function requiresApproval(totalMinor: bigint): boolean {
  return totalMinor >= APPROVAL_THRESHOLD_MINOR;
}

/** A line counts toward the net total; tax/charge lines are summed separately. */
export function computeTotals(items: LineItemInput[]): {
  subtotalMinor: bigint;
  taxMinor: bigint;
  chargesMinor: bigint;
  totalMinor: bigint;
} {
  let subtotal = 0n;
  let tax = 0n;
  let charges = 0n;
  for (const it of items) {
    const qty = BigInt(it.quantity ?? 1);
    const amt = BigInt(it.amountMinor) * qty;
    if (it.kind === "tax") tax += amt;
    else if (it.kind === "charge") charges += amt;
    else subtotal += amt;
  }
  return { subtotalMinor: subtotal, taxMinor: tax, chargesMinor: charges, totalMinor: subtotal + tax + charges };
}

export function outstandingMinor(totalMinor: bigint, paidMinor: bigint): bigint {
  const o = totalMinor - paidMinor;
  return o > 0n ? o : 0n;
}

/**
 * Status after a payment of `amount` lands on a bill currently at `paid` of
 * `total`. Returns the new paid amount and resulting status. Caller has already
 * guarded against over-payment.
 */
export function applyPayment(
  totalMinor: bigint,
  currentPaidMinor: bigint,
  amountMinor: bigint,
): { paidMinor: bigint; status: Extract<InvoiceStatus, "partially_paid" | "paid"> } {
  const paid = currentPaidMinor + amountMinor;
  return { paidMinor: paid, status: paid >= totalMinor ? "paid" : "partially_paid" };
}

export function assertPayable(status: string): void {
  if (status !== "issued" && status !== "partially_paid") {
    throw new DomainError("INVOICE_NOT_PAYABLE", `cannot pay a bill in '${status}' state (must be issued/partially_paid)`);
  }
}

export function assertIssuable(status: string): void {
  if (status !== "draft") {
    throw new DomainError("INVOICE_NOT_ISSUABLE", `cannot issue a bill in '${status}' state (must be draft)`);
  }
}

export function assertCancellable(status: string): void {
  if (status === "paid" || status === "cancelled") {
    throw new DomainError("INVOICE_NOT_CANCELLABLE", `cannot cancel a bill in '${status}' state`);
  }
}

/** Over-payment guard: a receipt may not exceed the outstanding balance. */
export function assertWithinOutstanding(totalMinor: bigint, paidMinor: bigint, amountMinor: bigint): void {
  if (amountMinor <= 0n) {
    throw new DomainError("INVALID_AMOUNT", "payment amount must be positive");
  }
  if (amountMinor > outstandingMinor(totalMinor, paidMinor)) {
    throw new DomainError(
      "OVERPAYMENT",
      `payment ${amountMinor} paise exceeds outstanding ${outstandingMinor(totalMinor, paidMinor)} paise`,
    );
  }
}
