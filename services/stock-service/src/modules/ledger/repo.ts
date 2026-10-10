/**
 * Ledger module read interface.
 *
 * GAP2-STOCK-DASHBOARD-02 — queries ONLY the ledger module's own schema
 * (stock_ledger). The dashboard handler calls this instead of selecting the
 * ledger table from within the dashboard query that also touches other
 * modules' schemas.
 */
import { eq, and, sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { scopedRead } from "../../shared/db.js";
import { stockLedger } from "./schema.js";

/** Count 'receipt' ledger rows posted since the start of the current month. */
export async function countReceiptsThisMonth(tenantId: string): Promise<number> {
  return runWithTenant(tenantId, () => scopedRead(async (tx) => {
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(stockLedger)
      .where(and(
        eq(stockLedger.tenantId, tenantId),
        eq(stockLedger.voucherType, "receipt"),
        sql`${stockLedger.postingDate} >= date_trunc('month', current_date)`,
      ));
    return row?.count ?? 0;
  }));
}
