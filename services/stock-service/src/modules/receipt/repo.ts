import { eq, and, gt, asc, sql, inArray } from "drizzle-orm";
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
  // Uses drizzle's inArray() query-builder helper rather than interpolating
  // lockedIds into a raw `sql` ANY(...) template -- postgres.js binds a plain
  // JS array as a single scalar parameter, not a Postgres array literal, which
  // throws "malformed array literal" (22P02) on every call that matches a row.
  const sumResult = await (tx as typeof db)
    .select({ available: sql<number>`COALESCE(SUM(${stockReceipts.remainingQty}), 0)::int` })
    .from(stockReceipts)
    .where(inArray(stockReceipts.id, lockedIds));
  return Number(sumResult[0]?.available ?? 0);
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
