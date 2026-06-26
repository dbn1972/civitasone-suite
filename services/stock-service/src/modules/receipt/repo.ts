import { eq, and, gt, asc, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { stockReceipts } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertReceipt(tx: Writer, row: typeof stockReceipts.$inferInsert): Promise<void> {
  await tx.insert(stockReceipts).values(row);
}

export async function lockAvailableQty(
  tx: Writer, tenantId: string, itemId: string, warehouseId: string,
): Promise<number> {
  // Step 1: Lock the matching rows with FOR UPDATE (no aggregate allowed here).
  const lockResult = await (tx as typeof db).execute(sql`
    SELECT id
    FROM entry.stock_receipts
    WHERE item_id = ${itemId}::uuid
      AND tenant_id = ${tenantId}::uuid
      AND warehouse_id = ${warehouseId}::uuid
      AND remaining_qty > 0
    FOR UPDATE
  `);
  const lockedRows = lockResult as unknown as Array<{ id: string }>;
  if (lockedRows.length === 0) return 0;
  const lockedIds = lockedRows.map((r) => r.id);

  // Step 2: Aggregate over the now-locked rows (no FOR UPDATE here).
  const sumResult = await (tx as typeof db).execute(sql`
    SELECT COALESCE(SUM(remaining_qty), 0)::int AS available
    FROM entry.stock_receipts
    WHERE id = ANY(${lockedIds}::uuid[])
  `);
  const rows = sumResult as unknown as Array<{ available: number }>;
  return Number(rows[0]?.available ?? 0);
}

export async function consumeFIFO(
  tx: Writer, tenantId: string, itemId: string, warehouseId: string, qty: number,
): Promise<Array<{ batchId: string; qty: number; unitCostMinor: bigint }>> {
  const batches = await (tx as typeof db).select().from(stockReceipts).where(and(
    eq(stockReceipts.tenantId, tenantId),
    eq(stockReceipts.itemId, itemId),
    eq(stockReceipts.warehouseId, warehouseId),
    gt(stockReceipts.remainingQty, 0),
  )).orderBy(asc(stockReceipts.createdAt));

  let needed = qty;
  const used: Array<{ batchId: string; qty: number; unitCostMinor: bigint }> = [];
  for (const b of batches) {
    if (needed <= 0) break;
    const take = Math.min(needed, b.remainingQty);
    used.push({ batchId: b.id, qty: take, unitCostMinor: b.unitCostMinor });
    await tx.update(stockReceipts)
      .set({ remainingQty: b.remainingQty - take })
      .where(eq(stockReceipts.id, b.id));
    needed -= take;
  }
  if (needed > 0) {
    throw new Error(`INSUFFICIENT_STOCK: Short by ${needed} units`);
  }
  return used;
}
