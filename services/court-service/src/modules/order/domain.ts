/**
 * order pure domain — id derivation and small order helpers (§23). No I/O.
 */
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";

/**
 * The set of allowed order-type categories is NOT hardcoded here: orderType is
 * validated against the tenant's config catalogue by the config/metadata engine
 * (§47). This module owns only structural rules — id derivation for idempotency.
 */

/** An order id is deterministic on (tenant + case + orderType + idempotencyKey)
 *  so re-submitting the SAME drafted order is idempotent end-to-end. The caller
 *  (commands.ts's recordOrder) derives idempotencyKey from a content hash of
 *  the order's meaningful fields -- NOT a random value -- specifically so a
 *  genuine retry of the SAME request reuses the SAME key and dedupes. */
export function deriveOrderId(
  tenantId: string, caseId: string, orderType: string, idempotencyKey: string,
): string {
  return deterministicId(COURT_NAMESPACE, `${tenantId}:order:${caseId}:${orderType}:${idempotencyKey}`);
}

/** A "speaking order" gives reasons (illustrative helper). The authoritative
 *  order-type semantics live in the tenant config catalogue (§47). */
export function isSpeakingOrder(orderType: string): boolean {
  return orderType === "speaking";
}

/**
 * Default order-type categories (§23) used as a FALLBACK when a tenant has not
 * configured its own `order_type` namespace in the config/metadata engine
 * (§47). The effective allowed set is the tenant’s configured `order_type`
 * values when any exist (AUTHORITATIVE — it REPLACES these defaults), else
 * these module defaults. Configuring the namespace fully overrides the
 * fallback: the tenant’s list must include every type it still wants (these
 * standard categories are NOT implicitly retained) and may add bespoke types
 * with no code change.
 */
export const DEFAULT_ORDER_TYPES = [
  "final_order", "interim", "interim_order", "injunction", "stay_order",
  "dismissal", "decree", "direction", "cost_order", "interlocutory",
  "review_order",
] as const;

/** Throw INVALID_ORDER_TYPE unless `orderType` is in the effective allowed set. */
export function assertOrderTypeAllowed(orderType: string, allowed: ReadonlySet<string>): void {
  if (!allowed.has(orderType)) {
    throw new Error(`INVALID_ORDER_TYPE: ${orderType} is not an allowed order type for this tenant`);
  }
}
