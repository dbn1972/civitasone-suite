import { eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { stockItems } from "../item/schema.js";

export async function getDashboard(tenantId: string) {
  const [total] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(stockItems)
    .where(eq(stockItems.tenantId, tenantId));

  return {
    totalSKUs: total?.count ?? 0,
    lowStockAlerts: 0,
    grnsThisMonth: 0,
    inventoryValue: 0,
  };
}
