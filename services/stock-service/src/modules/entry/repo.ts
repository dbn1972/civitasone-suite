import { eq, and, gte, lte, desc, sql, SQL } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead } from "../../shared/db.js";
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
  return runWithTenant(tenantId, () => scopedRead(async (tx) => {
    const rows = await tx.select().from(stockValuationRates)
      .where(and(
        eq(stockValuationRates.tenantId, tenantId),
        eq(stockValuationRates.itemId, itemId),
        eq(stockValuationRates.warehouseId, warehouseId)
      ))
      .limit(1);
    return rows[0]?.qty ?? 0;
  }));
}

export async function getValuationRate(tenantId: string, itemId: string, warehouseId: string): Promise<{ qty: number; rateMinor: bigint }> {
  return runWithTenant(tenantId, () => scopedRead(async (tx) => {
    const rows = await tx.select().from(stockValuationRates)
      .where(and(
        eq(stockValuationRates.tenantId, tenantId),
        eq(stockValuationRates.itemId, itemId),
        eq(stockValuationRates.warehouseId, warehouseId)
      ))
      .limit(1);
    const row = rows[0];
    return { qty: row?.qty ?? 0, rateMinor: row?.rateMinor ?? 0n };
  }));
}

/**
 * TX-001 -- tenant-scoped sibling of getValuationRate(). Reads through a
 * caller-supplied transaction handle so an already-open db.transaction()
 * (this service's entry consumer's entryCreate handler, which reads the
 * current valuation rate once per item for both the destination-warehouse
 * branch and the source-warehouse branch of its per-item loop) does not
 * open a second, bare db.transaction() from inside itself via
 * getValuationRate()'s scopedRead(): under pool.max concurrent in-flight
 * consumer transactions, the nested call has no free connection to open on
 * and deadlocks the pool silently. Route every read that happens inside an
 * already-open consumer transaction through this, not getValuationRate().
 */
export async function getValuationRateTx(tx: Writer, tenantId: string, itemId: string, warehouseId: string): Promise<{ qty: number; rateMinor: bigint }> {
  const rows = await (tx as typeof db).select().from(stockValuationRates)
    .where(and(
      eq(stockValuationRates.tenantId, tenantId),
      eq(stockValuationRates.itemId, itemId),
      eq(stockValuationRates.warehouseId, warehouseId)
    ))
    .limit(1);
  const row = rows[0];
  return { qty: row?.qty ?? 0, rateMinor: row?.rateMinor ?? 0n };
}

/**
 * GAP2-STOCK-ENTRY-02 - like getValuationRateTx but serializes the
 * read-modify-write for one (tenant,item,warehouse) so a weighted-average
 * revaluation cannot lose an update under concurrent writers.
 *
 * A row lock (SELECT ... FOR UPDATE) alone is not enough: when no valuation row
 * exists yet it locks nothing, two writers both read "absent", and the second
 * upsert overwrites the first with an absolute qty. So we first take a
 * transaction-scoped advisory lock on the key (held until commit/rollback);
 * that serializes the first-insert case as well as the update case. The
 * FOR UPDATE is kept as defence in depth for writers that bypass this helper.
 */
export async function lockValuationRateTx(tx: Writer, tenantId: string, itemId: string, warehouseId: string): Promise<{ qty: number; rateMinor: bigint }> {
  await (tx as typeof db).execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${itemId}:${warehouseId}`}, 0))`
  );
  const rows = await (tx as typeof db).select().from(stockValuationRates)
    .where(and(
      eq(stockValuationRates.tenantId, tenantId),
      eq(stockValuationRates.itemId, itemId),
      eq(stockValuationRates.warehouseId, warehouseId)
    ))
    .for("update")
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

export async function findEntryById(id: string, tenantId: string): Promise<EntryRow | null> {
  return runWithTenant(tenantId, () => scopedRead(async (tx) => {
    const rows = await tx.select().from(stockEntries)
      .where(and(eq(stockEntries.id, id), eq(stockEntries.tenantId, tenantId)))
      .limit(1);
    return rows[0] ?? null;
  }));
}

export async function markEntryPosted(tx: Writer, id: string, actorId: string): Promise<void> {
  await (tx as typeof db).update(stockEntries)
    .set({ status: "posted", updatedAt: new Date(), updatedBy: actorId })
    .where(eq(stockEntries.id, id));
}

export async function findLedger(
  tenantId: string,
  itemId: string | null,
  opts?: { from?: string; to?: string; warehouseId?: string; limit?: number; offset?: number },
) {
  return runWithTenant(tenantId, () => scopedRead(async (tx) => {
    const conditions: SQL[] = [eq(stockLedger.tenantId, tenantId)];
    if (itemId) conditions.push(eq(stockLedger.itemId, itemId));
    if (opts?.warehouseId) conditions.push(eq(stockLedger.warehouseId, opts.warehouseId));
    if (opts?.from) conditions.push(gte(stockLedger.postingDate, opts.from));
    if (opts?.to)   conditions.push(lte(stockLedger.postingDate, opts.to));
    return tx.select().from(stockLedger)
      .where(and(...conditions))
      // Newest first with a total tiebreak, so limit/offset pages are stable and
      // a full page is the latest N movements rather than an arbitrary subset.
      .orderBy(desc(stockLedger.postingDate), desc(stockLedger.createdAt), stockLedger.id)
      .limit(opts?.limit ?? 100)
      .offset(opts?.offset ?? 0);
  }));
}
