/**
 * Reads + write for the inbound rate-change request log.
 *
 * Unlike the other repos in this service these reads take the caller's `tx`
 * rather than opening their own via scopedRead(). That is deliberate: the
 * consumer must validate and record inside ONE transaction, so the facts it
 * decides on and the row it writes come from a single consistent snapshot.
 * Opening a nested transaction for each read would break that guarantee.
 */
import { eq, and, desc } from "drizzle-orm";
import type { ScopedTx } from "../../shared/db.js";
import { products } from "../products/schema.js";
import { productLifecycle } from "../products/governance-schema.js";
import { rates } from "./schema.js";
import { rateChangeRequests, type RateChangeRequestInsert } from "./change-request-schema.js";

/** Minimal product facts needed by the decision table. */
export interface ProductLifecycleFacts {
  id: string;
  lifecycleStatus: string;
}

export async function findProductForChange(
  tx: ScopedTx,
  productId: string,
  tenantId: string,
): Promise<ProductLifecycleFacts | null> {
  const rows = await tx
    .select({ id: products.id, lifecycleStatus: products.lifecycleStatus })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Current PC-002 state = newest history row. Null when tracking never began. */
export async function findCurrentLifecycleState(
  tx: ScopedTx,
  productId: string,
  tenantId: string,
): Promise<string | null> {
  const rows = await tx
    .select({ state: productLifecycle.state })
    .from(productLifecycle)
    .where(and(eq(productLifecycle.tenantId, tenantId), eq(productLifecycle.productId, productId)))
    .orderBy(desc(productLifecycle.effectiveFrom), desc(productLifecycle.createdAt))
    .limit(1);
  return rows[0]?.state ?? null;
}

/**
 * True only when the rate exists AND hangs off the referenced product — a rate id
 * from a different product is a rejection, not a silent acceptance.
 */
export async function rateBelongsToProduct(
  tx: ScopedTx,
  rateId: string,
  productId: string,
  tenantId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ id: rates.id })
    .from(rates)
    .where(and(eq(rates.id, rateId), eq(rates.productId, productId), eq(rates.tenantId, tenantId)))
    .limit(1);
  return rows.length > 0;
}

export async function insertRateChangeRequest(tx: ScopedTx, row: RateChangeRequestInsert): Promise<void> {
  await tx.insert(rateChangeRequests).values(row);
}
