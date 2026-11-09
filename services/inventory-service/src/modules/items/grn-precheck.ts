/**
 * UAT bundle 23: synchronous pre-check for procurement's GRN accept.
 *
 * procurement.grn.accepted is consumed by movements/consumer.ts, which refuses (NonRetryable, dead-letter) a
 * GRN whose lines name a SKU that is not exactly one active inventory item of the tenant, or whose receiving
 * store is not an active store. procurement answered 202 first, so the user believed the stock had been
 * received. procurement now asks this endpoint at the accept request and returns a 422 instead.
 *
 * Read-only and tenant-scoped (scopedRead => RLS). Mirrors activeItemsBySkuTx / activeStoreExistsTx.
 */
import { and, eq, inArray } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { items } from "./schema.js";
import { stores } from "../stores/schema.js";

export interface GrnPrecheck {
  unknownSkus: string[];
  ambiguousSkus: string[];
  /** null when no storeId was asked about. */
  storeKnown: boolean | null;
}

export async function grnPrecheck(tenantId: string, skus: string[], storeId?: string): Promise<GrnPrecheck> {
  const wanted = [...new Set(skus)];
  const counts = new Map<string, number>();
  if (wanted.length > 0) {
    const rows = await scopedRead((tx) => tx.select({ sku: items.sku }).from(items)
      .where(and(eq(items.tenantId, tenantId), inArray(items.sku, wanted), eq(items.isActive, true))));
    for (const r of rows) if (r.sku) counts.set(r.sku, (counts.get(r.sku) ?? 0) + 1);
  }
  let storeKnown: boolean | null = null;
  if (storeId) {
    const rows = await scopedRead((tx) => tx.select({ id: stores.id }).from(stores)
      .where(and(eq(stores.tenantId, tenantId), eq(stores.id, storeId), eq(stores.isActive, true))).limit(1));
    storeKnown = rows.length > 0;
  }
  return {
    unknownSkus: wanted.filter((s) => (counts.get(s) ?? 0) === 0),
    ambiguousSkus: wanted.filter((s) => (counts.get(s) ?? 0) > 1),
    storeKnown,
  };
}
