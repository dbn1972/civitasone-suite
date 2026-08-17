/**
 * consumables repo — DB reads/writes for stock balance tracking.
 * Read helpers are wrapped in db.transaction() so wrapWithTenantGuc injects
 * app.tenant_id before the read — a bare db.select() runs with no RLS GUC set.
 */
import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { consumableItems, consumableTransactions } from "./schema.js";
import type { ConsumableItemRow, ConsumableItemInsert, ConsumableTxnRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export class RepoError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "RepoError";
  }
}

/** Current stock balance for an item, tenant-scoped. Throws if the item does not exist. */
export async function getBalance(tenantId: string, itemId: string): Promise<number> {
  const rows = await db.transaction((tx) =>
    tx.select({ stockQty: consumableItems.stockQty }).from(consumableItems)
      .where(and(eq(consumableItems.tenantId, tenantId), eq(consumableItems.id, itemId)))
      .limit(1),
  );
  const row = rows[0];
  if (!row) throw new RepoError("CONSUMABLE_ITEM_NOT_FOUND", `consumable item ${itemId} not found`);
  return Number(row.stockQty);
}

/** Item row lookup within a caller-supplied transaction (consumer use). */
export async function getItemByIdTx(tx: Writer, tenantId: string, itemId: string): Promise<ConsumableItemRow | undefined> {
  const rows = await (tx as typeof db).select().from(consumableItems)
    .where(and(eq(consumableItems.tenantId, tenantId), eq(consumableItems.id, itemId)))
    .limit(1);
  return rows[0];
}

export async function insertItem(tx: Writer, row: ConsumableItemInsert): Promise<void> {
  await tx.insert(consumableItems).values(row);
}

export async function insertTransaction(tx: Writer, row: Omit<ConsumableTxnRow, "createdAt">): Promise<void> {
  await tx.insert(consumableTransactions).values(row);
}

/**
 * Apply `delta` to an item's stock balance and return the resulting balance.
 *
 * Accepts an optional caller-supplied transaction (`tx`) so the consumer that
 * processes `estab.consumable.transaction` can fold this write into its own
 * single db.transaction() alongside markProcessed + the transaction-row
 * insert + the audit outbox write — per this service's rule that one
 * consumer handler is one database transaction. When called without `tx`
 * (e.g. directly from tests or ad-hoc scripts) it opens its own transaction.
 *
 * Calling this twice with the same delta accumulates: balance -> balance+delta
 * -> balance+2*delta. Callers are responsible for validating the delta
 * against the current balance first (see domain.ts assertSufficientBalance) —
 * this function does not re-derive the sign/effect from a txnType.
 */
export async function upsertBalance(tenantId: string, itemId: string, delta: number, tx?: Writer): Promise<number> {
  const run = async (executor: Writer): Promise<number> => {
    const rows = await (executor as typeof db).select({ stockQty: consumableItems.stockQty })
      .from(consumableItems)
      .where(and(eq(consumableItems.tenantId, tenantId), eq(consumableItems.id, itemId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new RepoError("CONSUMABLE_ITEM_NOT_FOUND", `consumable item ${itemId} not found`);
    const next = Number(row.stockQty) + delta;
    await executor.update(consumableItems)
      .set({ stockQty: next.toFixed(2), updatedAt: new Date() })
      .where(and(eq(consumableItems.tenantId, tenantId), eq(consumableItems.id, itemId)));
    return next;
  };
  if (tx) return run(tx);
  return db.transaction((t) => run(t));
}

// Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
// before this read — a bare db.select() runs with no RLS GUC set.
export async function listTransactionsByItem(tenantId: string, itemId: string, limit = 200): Promise<ConsumableTxnRow[]> {
  return db.transaction((tx) =>
    tx.select().from(consumableTransactions)
      .where(and(eq(consumableTransactions.tenantId, tenantId), eq(consumableTransactions.itemId, itemId)))
      .limit(limit),
  );
}
