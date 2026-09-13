/**
 * DOM-011: pure three-way-match tolerance resolution + evaluation logic.
 * No DB/queue imports here by design (mirrors payroll-service's
 * payroll/domain.ts split: resolveRunStatutoryConfig touches the DB in
 * consumer.ts, resolveStatutoryConfig itself is pure) -- keeps the actual
 * matching decision unit-testable without a running Postgres.
 */

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export interface ToleranceConfig {
  qtyTolerancePct: number;
  priceTolerancePct: number;
  totalTolerancePct: number;
}

/**
 * DOM-011's own specified platform defaults. Unlike payroll's DOM-008 (which
 * seeded byte-identical-to-pre-fix values so no existing tenant's output
 * changed), 0% qty / 2% price are a DELIBERATE, gap-specified tightening --
 * see migration 0033's comment for why. 5% total is the value that WAS
 * hardcoded pre-fix, preserved as the default for that axis.
 */
export const DEFAULT_TOLERANCE_CONFIG: ToleranceConfig = {
  qtyTolerancePct: 0,
  priceTolerancePct: 2,
  totalTolerancePct: 5,
};

/**
 * A `procurement.three_way_match_config` row as loaded from the DB;
 * `tenantId: null` means the platform default (DB sentinel zero-UUID mapped
 * to null at the repo boundary, same convention as payroll's
 * StatutoryConfigRow).
 */
export interface ToleranceConfigRow extends ToleranceConfig {
  tenantId: string | null;
}

/**
 * Pure resolution: the tenant's own row wins; else the platform-default row;
 * else the literal DEFAULT_TOLERANCE_CONFIG (belt-and-suspenders -- migration
 * 0033 always seeds a platform-default row, so this last fallback should
 * never be reached in practice, but the consumer must never throw just
 * because a config row is somehow missing).
 */
export function resolveToleranceConfig(rows: ToleranceConfigRow[], tenantId: string): ToleranceConfig {
  const own = rows.find((r) => r.tenantId === tenantId);
  if (own) return { qtyTolerancePct: own.qtyTolerancePct, priceTolerancePct: own.priceTolerancePct, totalTolerancePct: own.totalTolerancePct };
  const platform = rows.find((r) => r.tenantId === null);
  if (platform) return { qtyTolerancePct: platform.qtyTolerancePct, priceTolerancePct: platform.priceTolerancePct, totalTolerancePct: platform.totalTolerancePct };
  return DEFAULT_TOLERANCE_CONFIG;
}

/** A single GRN line's own ordered/accepted quantities (already scoped to what THIS delivery batch was ordered for -- see note on computeQtyVariancePct). */
export interface GrnQtyLine {
  orderedQty: number;
  acceptedQty: number;
}

export interface MatchInput {
  poAmountMinor: bigint;
  /** sum(PO unit price * GRN accepted qty) -- price held constant at the PO's own rate, so any PO-vs-GRN gap is purely a quantity effect. */
  grnAmountMinor: bigint;
  /** GRN items' own orderedQty/acceptedQty -- independent of price/PO. */
  grnQtyLines: GrnQtyLine[];
  invoicePresent: boolean;
  invoiceAmountMinor: bigint;
}

export interface MatchResult {
  qtyVariancePct: number;
  priceVariancePct: number;
  totalVariancePct: number;
  matchStatus: "matched" | "mismatch";
}

function diff(a: bigint, b: bigint): bigint {
  return a > b ? a - b : b - a;
}

/** BigInt-safe percent difference, truncated to 2 decimal places like the existing (pre-fix) variance formula. */
function pctDiff(a: bigint, b: bigint, base: bigint): number {
  if (base <= 0n) return 0;
  return Number((diff(a, b) * 10000n) / base) / 100;
}

/**
 * Quantity axis: a delivery-quantity signal, independent of price. Uses each
 * GRN item's OWN orderedQty/acceptedQty -- already scoped to what THIS
 * delivery batch was ordered for, per grn/domain.ts's computeThreeWayMatch
 * comment ("partial / part-supply deliveries are valid... the GRN records
 * what was received THIS time; the PO stays open for the balance"). Comparing
 * against the GRN's own ordered quantity (never the PO's full total quantity)
 * is what makes this safe for a PO fulfilled across multiple partial GRNs --
 * each GRN is judged against what IT was ordered to deliver, not the whole PO.
 */
function computeQtyVariancePct(lines: GrnQtyLine[]): number {
  const totalOrdered = lines.reduce((s, l) => s + l.orderedQty, 0);
  const totalAccepted = lines.reduce((s, l) => s + l.acceptedQty, 0);
  if (totalOrdered <= 0) return 0;
  return (Math.abs(totalOrdered - totalAccepted) * 10000 / totalOrdered) / 100;
}

/**
 * Evaluate a three-way match against a resolved ToleranceConfig: three
 * independent axes instead of DOM-011's one blended total-only check.
 *
 *  - qty:   accepted vs ordered quantity on the GRN itself (price-independent,
 *           see computeQtyVariancePct).
 *  - price: invoice vs grnAmountMinor (the PO-priced value of what was
 *           ACTUALLY delivered, not what was ordered). Because grnAmountMinor
 *           already bakes in the real accepted quantity at the PO's own unit
 *           price, any remaining gap against the invoice is attributable to
 *           the vendor's billed rate differing from the contracted one (plus
 *           tax/logistics) -- a genuine price signal, decoupled from
 *           quantity. 0 (not checked) when no invoice has been attached yet.
 *  - total: the original blended PO-vs-GRN / PO-vs-Invoice check, preserved
 *           byte-for-byte in formula, now gated by a configurable threshold
 *           instead of a hardcoded `<= 5`.
 *
 * "matched" requires ALL THREE axes within their configured tolerance --
 * closes the gap where a quantity shortfall could hide behind an offsetting
 * price change (or vice versa) as long as the blended total still netted
 * under 5%.
 */
export function evaluateMatch(input: MatchInput, tolerance: ToleranceConfig): MatchResult {
  const qtyVariancePct = computeQtyVariancePct(input.grnQtyLines);
  const priceVariancePct = input.invoicePresent
    ? pctDiff(input.grnAmountMinor, input.invoiceAmountMinor, input.grnAmountMinor)
    : 0;

  let maxDiff = diff(input.poAmountMinor, input.grnAmountMinor);
  if (input.invoicePresent) {
    const invDiff = diff(input.poAmountMinor, input.invoiceAmountMinor);
    if (invDiff > maxDiff) maxDiff = invDiff;
  }
  const totalVariancePct = input.poAmountMinor > 0n ? Number((maxDiff * 10000n) / input.poAmountMinor) / 100 : 0;

  const matchStatus: MatchResult["matchStatus"] =
    qtyVariancePct <= tolerance.qtyTolerancePct &&
    priceVariancePct <= tolerance.priceTolerancePct &&
    totalVariancePct <= tolerance.totalTolerancePct
      ? "matched"
      : "mismatch";

  return { qtyVariancePct, priceVariancePct, totalVariancePct, matchStatus };
}
