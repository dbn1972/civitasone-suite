/**
 * Forecast repository — queries movement records for feature computation.
 *
 * Reads daily aggregated stock movements (receipts + issues) for an item-warehouse pair
 * to supply the forecasting algorithm with historical demand data.
 *
 * Requirements: 8.5, 8.7
 */
import { db } from "../../shared/db.js";
import { stockLedger } from "../movements/schema.js";
import { items } from "../items/schema.js";
import { eq, and, gte, sql } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import type { MovementRecord } from "./domain.js";

/**
 * Count movement records (issues) for a given item+warehouse in the past 90 days.
 * Used to enforce the minimum 30 records threshold.
 */
export async function countMovements(tenantId: string, itemId: string, warehouseId?: string): Promise<number> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const conditions = [
    eq(stockLedger.tenantId, tenantId),
    eq(stockLedger.itemId, itemId),
    gte(stockLedger.postingDate, ninetyDaysAgo),
  ];
  if (warehouseId) {
    conditions.push(eq(stockLedger.storeId, warehouseId));
  }

  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(stockLedger)
    .where(and(...conditions));

  return result[0]?.count ?? 0;
}

/**
 * Retrieve daily movement records for feature computation.
 * Returns date + total qty per day (issue qty as demand proxy).
 */
export async function getDailyMovements(tenantId: string, itemId: string, warehouseId?: string, days: number = 90): Promise<MovementRecord[]> {
  const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const conditions = [
    eq(stockLedger.tenantId, tenantId),
    eq(stockLedger.itemId, itemId),
    gte(stockLedger.postingDate, sinceDate),
  ];
  if (warehouseId) {
    conditions.push(eq(stockLedger.storeId, warehouseId));
  }

  const rows = await db
    .select({
      date: stockLedger.postingDate,
      qty: sql<number>`coalesce(sum(${stockLedger.qtyOut}), 0)::int`,
    })
    .from(stockLedger)
    .where(and(...conditions))
    .groupBy(stockLedger.postingDate)
    .orderBy(stockLedger.postingDate);

  return rows.map((r) => ({ date: String(r.date), qty: r.qty }));
}

/**
 * Get item details needed for forecasting (lead time, reorder level).
 * Note: leadTimeDays is not stored in the items schema — uses a configurable default.
 */
export async function getItemForecastMeta(tenantId: string, itemId: string): Promise<{ leadTimeDays: number; reorderLevel: number; reorderQty: number } | null> {
  const key = cache.makeKey(tenantId, RESOURCE.item, `${itemId}:forecast-meta`);
  return cache.getOrLoad(key, async () => {
    const rows = await db
      .select({
        reorderLevel: items.reorderLevel,
        reorderQty: items.reorderQty,
      })
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.tenantId, tenantId)))
      .limit(1);

    if (rows.length === 0) return null;
    const defaultLeadTimeDays = Number(process.env.INVENTORY_DEFAULT_LEAD_TIME_DAYS ?? "7");
    return {
      leadTimeDays: defaultLeadTimeDays,
      reorderLevel: rows[0]!.reorderLevel ?? 0,
      reorderQty: rows[0]!.reorderQty ?? 0,
    };
  });
}
