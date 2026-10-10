import { eq, and, sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead } from "../../shared/db.js";
import { stockValuationRates, type ValuationRateRow } from "./schema.js";

export async function findValuationRate(tenantId: string, itemId: string, warehouseId: string): Promise<ValuationRateRow | null> {
  return runWithTenant(tenantId, () => scopedRead(async (tx) => {
    const rows = await tx.select().from(stockValuationRates)
      .where(and(
        eq(stockValuationRates.tenantId, tenantId),
        eq(stockValuationRates.itemId, itemId),
        eq(stockValuationRates.warehouseId, warehouseId),
      ))
      .limit(1);
    return rows[0] ?? null;
  }));
}

/**
 * GAP2-STOCK-DASHBOARD-02 — valuation-module read model for the dashboard.
 *
 * Queries ONLY the valuation module's own schema (stock_valuation_rates). The
 * dashboard handler assembles cross-module figures in JS from this + the item
 * module's own query, instead of a single SQL statement that reaches from the
 * item schema into the valuation schema (a cross-module correlated subquery).
 */
export async function getTenantValuation(tenantId: string): Promise<{
  totalValuePaise: string;
  onHandByItem: Map<string, number>;
}> {
  return runWithTenant(tenantId, () => scopedRead(async (tx) => {
    const [valueRow] = await tx
      .select({ total: sql<string>`COALESCE(SUM(qty * rate_minor), 0)::text` })
      .from(stockValuationRates)
      .where(eq(stockValuationRates.tenantId, tenantId));

    const perItem = await tx
      .select({
        itemId: stockValuationRates.itemId,
        onHand: sql<string>`COALESCE(SUM(qty), 0)::text`,
      })
      .from(stockValuationRates)
      .where(eq(stockValuationRates.tenantId, tenantId))
      .groupBy(stockValuationRates.itemId);

    const onHandByItem = new Map<string, number>();
    for (const r of perItem) onHandByItem.set(r.itemId, Number(r.onHand));
    return { totalValuePaise: valueRow?.total ?? "0", onHandByItem };
  }));
}
