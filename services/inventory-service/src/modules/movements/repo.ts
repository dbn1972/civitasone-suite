/**
 * movements repo — Drizzle queries against the `inventory` schema ONLY.
 * Balance reads on the write path take a row lock (FOR UPDATE) so concurrent
 * movements on the same (item, store) serialise instead of racing.
 */
import { eq, and, lte, gte, desc, sql, type SQL } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  movements, movementLines, stockBalances, stockLedger,
  type MovementInsert, type MovementLineInsert, type LedgerInsert,
  type StockBalanceRow, type LedgerRow,
} from "./schema.js";
import { items } from "../items/schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface BalanceState { qty: number; rateMinor: bigint }

// ── Movement header + lines ──────────────────────────────────────────────

export async function insertMovement(tx: Writer, row: MovementInsert): Promise<void> {
  await tx.insert(movements).values(row);
}

export async function insertMovementLines(tx: Writer, rows: MovementLineInsert[]): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(movementLines).values(rows);
}

export async function appendLedger(tx: Writer, row: LedgerInsert): Promise<void> {
  await tx.insert(stockLedger).values(row);
}

// ── Stock balances ─────────────────────────────────────────────────────────

/** Read + lock the current balance for an (item, store) inside the write tx. */
export async function lockBalance(tx: Tx, tenantId: string, itemId: string, storeId: string): Promise<BalanceState> {
  const rows = await tx.select().from(stockBalances)
    .where(and(
      eq(stockBalances.tenantId, tenantId),
      eq(stockBalances.itemId, itemId),
      eq(stockBalances.storeId, storeId),
    ))
    .limit(1)
    .for("update");
  const row = rows[0];
  return { qty: row?.onHandQty ?? 0, rateMinor: row?.avgRateMinor ?? 0n };
}

/** Insert or update the (item, store) balance, bumping its optimistic version. */
export async function upsertBalance(
  tx: Writer, tenantId: string, itemId: string, storeId: string,
  qty: number, rateMinor: bigint, currency: string,
): Promise<void> {
  await (tx as typeof db).insert(stockBalances)
    .values({ tenantId, itemId, storeId, onHandQty: qty, avgRateMinor: rateMinor, currency, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [stockBalances.tenantId, stockBalances.itemId, stockBalances.storeId],
      set: { onHandQty: qty, avgRateMinor: rateMinor, currency, updatedAt: new Date(), version: sql`${stockBalances.version} + 1` },
    });
}

export async function listBalances(
  tenantId: string, opts: { itemId?: string; storeId?: string; limit: number; offset: number },
): Promise<StockBalanceRow[]> {
  const conds: SQL[] = [eq(stockBalances.tenantId, tenantId)];
  if (opts.itemId) conds.push(eq(stockBalances.itemId, opts.itemId));
  if (opts.storeId) conds.push(eq(stockBalances.storeId, opts.storeId));
  return scopedRead((tx) => tx.select().from(stockBalances)
    .where(and(...conds))
    .limit(opts.limit).offset(opts.offset));
}

// ── Stock ledger ─────────────────────────────────────────────────────────

export async function listLedger(
  tenantId: string, opts: { itemId?: string; storeId?: string; from?: string; to?: string; limit: number; offset: number },
): Promise<LedgerRow[]> {
  const conds: SQL[] = [eq(stockLedger.tenantId, tenantId)];
  if (opts.itemId) conds.push(eq(stockLedger.itemId, opts.itemId));
  if (opts.storeId) conds.push(eq(stockLedger.storeId, opts.storeId));
  if (opts.from) conds.push(gte(stockLedger.postingDate, opts.from));
  if (opts.to) conds.push(lte(stockLedger.postingDate, opts.to));
  return scopedRead((tx) => tx.select().from(stockLedger)
    .where(and(...conds))
    .orderBy(desc(stockLedger.createdAt))
    .limit(opts.limit).offset(opts.offset));
}

// ── Low-stock report ─────────────────────────────────────────────────────

export interface LowStockRow {
  itemId: string;
  storeId: string;
  name: string;
  sku: string | null;
  onHandQty: number;
  reorderLevel: number;
  reorderQty: number;
}

/**
 * Items whose on-hand at a store has fallen to/below a positive reorder level.
 * Joins balances to the item master so the report carries the reorder policy.
 */
export async function listLowStock(tenantId: string, limit: number, offset: number): Promise<LowStockRow[]> {
  const rows = await scopedRead((tx) => tx.select({
    itemId: stockBalances.itemId,
    storeId: stockBalances.storeId,
    name: items.name,
    sku: items.sku,
    onHandQty: stockBalances.onHandQty,
    reorderLevel: items.reorderLevel,
    reorderQty: items.reorderQty,
  })
    .from(stockBalances)
    .innerJoin(items, and(eq(stockBalances.itemId, items.id), eq(stockBalances.tenantId, items.tenantId)))
    .where(and(
      eq(stockBalances.tenantId, tenantId),
      gte(items.reorderLevel, 1),
      lte(stockBalances.onHandQty, items.reorderLevel),
    ))
    .limit(limit).offset(offset));
  return rows;
}

/** Read reorder policy for an item (used by the consumer's low-stock check). */
export async function getReorderPolicy(tx: Tx, tenantId: string, itemId: string): Promise<{ reorderLevel: number; reorderQty: number } | null> {
  const rows = await tx.select({ reorderLevel: items.reorderLevel, reorderQty: items.reorderQty })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}
