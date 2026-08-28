/**
 * order pure domain — id derivation and small order helpers (§23). No I/O.
 */
import { createHash } from "node:crypto";
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";

/**
 * The set of allowed order-type categories is NOT hardcoded here: orderType is
 * validated against the tenant's config catalogue by the config/metadata engine
 * (§47). This module owns only structural rules — id derivation for idempotency.
 */

/** An order id is deterministic on (tenant + case + orderType + idempotencyKey)
 *  so a redelivery of the SAME record intent is idempotent end-to-end.
 *  idempotencyKey is normally hashOrderContent(...) below (a content hash of
 *  the submitted fields), so a genuine client retry -- same case, same order
 *  content -- always derives the SAME key and therefore the same orderId, and
 *  dedupes via markProcessed/onConflictDoNothing; a caller with its own
 *  stronger idempotency key (a client-supplied x-idempotency-key) may still
 *  pass one directly instead. */
export function deriveOrderId(
  tenantId: string, caseId: string, orderType: string, idempotencyKey: string,
): string {
  return deterministicId(COURT_NAMESPACE, `${tenantId}:order:${caseId}:${orderType}:${idempotencyKey}`);
}

/**
 * Content-derived idempotency key for a recorded order -- a SHA-256 hex digest
 * over every field that distinguishes one order from another (hearingId,
 * orderType, orderText, orderDate). An identical resubmission (a client
 * double-click or a network-timeout retry) hashes to the SAME key and
 * therefore the same orderId, so it dedupes instead of creating a second,
 * distinct draft order row.
 *
 * The fields are combined via JSON.stringify (not a plain string join): each
 * element is individually quoted/escaped, so a value can never shift across a
 * field boundary and collide with a differently-split input.
 *
 * USED ONLY AS A FALLBACK (see recordOrder in commands.ts, which prefers a
 * caller-supplied x-idempotency-key via idempotentId() when present) --
 * DELIBERATE TRADEOFF, mirroring filing/domain.ts's identical hashFilingContent:
 * this fallback makes the id purely CONTENT-based, with no random or time
 * component, so two GENUINELY DISTINCT orders that happen to share the same
 * hearingId/orderType/orderText/orderDate collide onto one id and the second
 * is silently dropped. Judged the lesser risk versus silently duplicating a
 * court order draft on every retry for a caller that manages no idempotency
 * key of its own -- a caller that needs two content-identical orders to both
 * persist should send a distinct x-idempotency-key per submission instead of
 * relying on this fallback.
 */
export function hashOrderContent(
  hearingId: string | undefined, orderType: string, orderText: string, orderDate: string | undefined,
): string {
  const content = JSON.stringify([hearingId ?? null, orderType, orderText, orderDate ?? null]);
  return createHash("sha256").update(content, "utf8").digest("hex");
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
