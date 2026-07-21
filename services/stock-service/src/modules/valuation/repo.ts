import { eq, and } from "drizzle-orm";
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
