import { eq, and, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { stockEntries, stockEntryItems, type EntryInsert, type EntryItemInsert, type EntryRow } from "./schema.js";
import { stockLedger, type LedgerInsert } from "../ledger/schema.js";
import { stockValuationRates } from "../valuation/schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertEntry(tx: Writer, row: EntryInsert): Promise<void> {
  await tx.insert(stockEntries).values(row);
}

export async function insertEntryItems(tx: Writer, rows: EntryItemInsert[]): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(stockEntryItems).values(rows);
}

export async function appendLedger(tx: Writer, row: LedgerInsert): Promise<void> {
  await tx.insert(stockLedger).values(row);
}

export async function getCurrentBalance(tenantId: string, itemId: string, warehouseId: string): Promise<number> {
  const rows = await db.select().from(stockValuationRates)
    .where(and(
      eq(stockValuationRates.tenantId, tenantId),
      eq(stockValuationRates.itemId, itemId),
      eq(stockValuationRates.warehouseId, warehouseId)
    ))
    .limit(1);
  return rows[0]?.qty ?? 0;
}

export async function getValuationRate(tenantId: string, itemId: string, warehouseId: string): Promise<{ qty: number; rateMinor: bigint }> {
  const rows = await db.select().from(stockValuationRates)
    .where(and(
      eq(stockValuationRates.tenantId, tenantId),
      eq(stockValuationRates.itemId, itemId),
      eq(stockValuationRates.warehouseId, warehouseId)
    ))
    .limit(1);
  const row = rows[0];
  return { qty: row?.qty ?? 0, rateMinor: row?.rateMinor ?? 0n };
}

export async function upsertValuationRate(
  tx: Writer, tenantId: string, itemId: string, warehouseId: string,
  qty: number, rateMinor: bigint, currency: string
): Promise<void> {
  await (tx as typeof db).insert(stockValuationRates)
    .values({ tenantId, itemId, warehouseId, qty, rateMinor, currency, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [stockValuationRates.tenantId, stockValuationRates.itemId, stockValuationRates.warehouseId],
      set: { qty, rateMinor, currency, updatedAt: new Date() },
    });
}

export async function findEntryById(id: string): Promise<EntryRow | null> {
  const rows = await db.select().from(stockEntries).where(eq(stockEntries.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function markEntryPosted(tx: Writer, id: string, actorId: string): Promise<void> {
  await (tx as typeof db).update(stockEntries)
    .set({ status: "posted", updatedAt: new Date(), updatedBy: actorId })
    .where(eq(stockEntries.id, id));
}

export async function findLedger(tenantId: string, itemId: string, opts?: { from?: string; to?: string; limit?: number; offset?: number }) {
  return db.select().from(stockLedger)
    .where(and(
      eq(stockLedger.tenantId, tenantId),
      eq(stockLedger.itemId, itemId),
      opts?.from ? gte(stockLedger.postingDate, opts.from) : undefined,
      opts?.to   ? lte(stockLedger.postingDate, opts.to)   : undefined,
    ))
    .limit(opts?.limit ?? 100)
    .offset(opts?.offset ?? 0);
}
