import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { stockValuationRates, type ValuationRateRow } from "./schema.js";

export async function findValuationRate(tenantId: string, itemId: string, warehouseId: string): Promise<ValuationRateRow | null> {
  const rows = await db.select().from(stockValuationRates)
    .where(and(
      eq(stockValuationRates.tenantId, tenantId),
      eq(stockValuationRates.itemId, itemId),
      eq(stockValuationRates.warehouseId, warehouseId),
    ))
    .limit(1);
  return rows[0] ?? null;
}
