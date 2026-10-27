export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export function assertNotBlacklisted(vendorType: string): void {
  if (vendorType === "blacklisted") {
    throw new DomainError("VENDOR_BLACKLISTED", "vendor is blacklisted and cannot be used");
  }
}

export function assertCanEmpanel(vendorType: string): void {
  if (vendorType === "blacklisted") {
    throw new DomainError("VENDOR_BLACKLISTED", "blacklisted vendor cannot be empanelled");
  }
}

/**
 * GAP-PROCUREMENT-EMPANELMENT-05 / ORDERS-NEW-06 - an empanelled vendor whose
 * every empanelment has lapsed (past validUntil, or no longer active) must not
 * be ordered from. A vendor with NO empanelment rows is a registered vendor
 * (e.g. a tender winner) and is unaffected: whether a PO may go to a
 * non-empanelled vendor is a procurement-policy decision, not enforced here.
 * `today` is a YYYY-MM-DD string (valid through that date inclusive).
 */
export function isEmpanelmentLapsed(
  rows: ReadonlyArray<{ status: string; validUntil: string | null }>,
  today: string,
): boolean {
  if (rows.length === 0) return false;
  return !rows.some((r) => r.status === "active" && (r.validUntil == null || r.validUntil >= today));
}

/**
 * D4c #28 (GAP-PROCUREMENT-ORDERS-NEW-06): a vendor with NO empanelment record
 * may be ordered from only when the order is linked to an awarded tender that
 * this vendor won, or carries a GeM order reference. A vendor WITH records is
 * unaffected here (lapsed ones are handled by assertEmpanelmentCurrent).
 */
export function assertNonEmpanelledOrderBasis(
  rows: ReadonlyArray<unknown>,
  basis: { tenderAwardedToVendor: boolean; gemOrderRef?: string | null },
): void {
  if (rows.length > 0) return;
  if (basis.tenderAwardedToVendor || (basis.gemOrderRef ?? "").trim() !== "") return;
  throw new DomainError(
    "VENDOR_NOT_EMPANELLED",
    "the vendor has no empanelment record; link an awarded tender won by this vendor or give a GeM order reference",
  );
}

export function assertEmpanelmentCurrent(
  rows: ReadonlyArray<{ status: string; validUntil: string | null }>,
  today: string,
): void {
  if (isEmpanelmentLapsed(rows, today)) {
    throw new DomainError("EMPANELMENT_EXPIRED", "the vendor's empanelment has expired; renew it before raising an order");
  }
}
