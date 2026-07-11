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
 *  mints the idempotencyKey (a random UUID) per record intent. */
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
