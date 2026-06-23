import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { stockItems } from "../item/schema.js";
import { stockLedger } from "../ledger/schema.js";
import { stockValuationRates } from "../valuation/schema.js";

export async function getDashboard(tenantId: string) {
  const [total] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(stockItems)
    .where(eq(stockItems.tenantId, tenantId));

  const [grnsRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(stockLedger)
    .where(
      and(
        eq(stockLedger.tenantId, tenantId),
        eq(stockLedger.voucherType, "receipt"),
        sql`${stockLedger.postingDate} >= date_trunc('month', current_date)`,
      )
    );

  const [valueRow] = await db
    .select({
      total: sql<string>`COALESCE(SUM(qty * rate_minor), 0)::text`,
    })
    .from(stockValuationRates)
    .where(eq(stockValuationRates.tenantId, tenantId));

  const [alertRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(stockItems)
    .where(
      and(
        eq(stockItems.tenantId, tenantId),
        sql`${stockItems.reorderLevel} > 0`,
        sql`COALESCE((
          SELECT sv.qty FROM valuation.stock_valuation_rates sv
          WHERE sv.tenant_id = ${stockItems.tenantId}
            AND sv.item_id = ${stockItems.id}
          LIMIT 1
        ), 0) < ${stockItems.reorderLevel}`,
      )
    );

  return {
    totalSKUs: total?.count ?? 0,
    lowStockAlerts: alertRow?.count ?? 0,
    grnsThisMonth: grnsRow?.count ?? 0,
    inventoryValue: Number(valueRow?.total ?? "0"),
  };
}
