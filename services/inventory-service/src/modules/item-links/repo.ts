/**
 * item-links repo -- Drizzle queries against the `inventory` schema ONLY (the stock-service
 * side is reached over HTTP, see shared/stock-client.ts). Every read is tenant-scoped.
 */
import { eq, and, inArray, sql, asc, desc, type SQL } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { DomainError } from "../../shared/domain.js";
import { items } from "../items/schema.js";
import { itemStockLinks, type ItemStockLinkRow, type ItemStockLinkInsert } from "./schema.js";
import type { InvItem } from "./domain.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select" | "delete">;

// ── Links ─────────────────────────────────────────────────────────────────

export async function insertLink(tx: Writer, row: ItemStockLinkInsert): Promise<void> {
  await tx.insert(itemStockLinks).values(row);
}

/** Conditional delete: a link that is already gone (a concurrent unlink won) throws, never no-ops silently. */
export async function deleteLink(tx: Writer, id: string, tenantId: string): Promise<ItemStockLinkRow> {
  const rows = await (tx as typeof db).delete(itemStockLinks)
    .where(and(eq(itemStockLinks.id, id), eq(itemStockLinks.tenantId, tenantId)))
    .returning();
  const row = rows[0];
  if (!row) throw new DomainError("LINK_NOT_FOUND", `item link ${id} not found or already removed`);
  return row;
}

export async function listLinks(tenantId: string, limit: number, offset: number): Promise<{ rows: ItemStockLinkRow[]; total: number }> {
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(itemStockLinks)
      .where(eq(itemStockLinks.tenantId, tenantId))
      .orderBy(desc(itemStockLinks.linkedAt), asc(itemStockLinks.id))
      .limit(limit).offset(offset);
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(itemStockLinks)
      .where(eq(itemStockLinks.tenantId, tenantId));
    return { rows, total: c?.n ?? 0 };
  });
}

/** Every link of the tenant (bounded) -- used to classify items as linked/unlinked. */
export async function allLinks(tenantId: string, cap = 10000): Promise<ItemStockLinkRow[]> {
  return scopedRead((tx) => tx.select().from(itemStockLinks)
    .where(eq(itemStockLinks.tenantId, tenantId))
    .orderBy(asc(itemStockLinks.id)).limit(cap));
}

export async function findLink(tenantId: string, id: string): Promise<ItemStockLinkRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(itemStockLinks)
    .where(and(eq(itemStockLinks.tenantId, tenantId), eq(itemStockLinks.id, id))).limit(1));
  return rows[0] ?? null;
}

export async function findLinkByInventory(tenantId: string, inventoryItemId: string): Promise<ItemStockLinkRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(itemStockLinks)
    .where(and(eq(itemStockLinks.tenantId, tenantId), eq(itemStockLinks.inventoryItemId, inventoryItemId))).limit(1));
  return rows[0] ?? null;
}

export async function findLinkByStock(tenantId: string, stockItemId: string): Promise<ItemStockLinkRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(itemStockLinks)
    .where(and(eq(itemStockLinks.tenantId, tenantId), eq(itemStockLinks.stockItemId, stockItemId))).limit(1));
  return rows[0] ?? null;
}

/** Links touching any of the given stock ids (picker: stock hits whose partner may not match the text). */
export async function linksForStockIds(tenantId: string, stockIds: string[]): Promise<ItemStockLinkRow[]> {
  if (stockIds.length === 0) return [];
  return scopedRead((tx) => tx.select().from(itemStockLinks)
    .where(and(eq(itemStockLinks.tenantId, tenantId), inArray(itemStockLinks.stockItemId, stockIds))));
}

export async function linksForInventoryIds(tenantId: string, ids: string[]): Promise<ItemStockLinkRow[]> {
  if (ids.length === 0) return [];
  return scopedRead((tx) => tx.select().from(itemStockLinks)
    .where(and(eq(itemStockLinks.tenantId, tenantId), inArray(itemStockLinks.inventoryItemId, ids))));
}

// ── Inventory items (id/name/sku projection) ───────────────────────────────

const basic = { id: items.id, name: items.name, sku: items.sku };

export async function findInventoryItem(tenantId: string, id: string): Promise<InvItem | null> {
  const rows = await scopedRead((tx) => tx.select(basic).from(items)
    .where(and(eq(items.tenantId, tenantId), eq(items.id, id))).limit(1));
  return rows[0] ?? null;
}

export async function inventoryItemsByIds(tenantId: string, ids: string[]): Promise<InvItem[]> {
  if (ids.length === 0) return [];
  return scopedRead((tx) => tx.select(basic).from(items)
    .where(and(eq(items.tenantId, tenantId), inArray(items.id, ids))));
}

/** Active inventory items, stable order, bounded. */
export async function listActiveInventoryItems(tenantId: string, cap: number): Promise<{ rows: InvItem[]; total: number }> {
  return scopedRead(async (tx) => {
    const rows = await tx.select(basic).from(items)
      .where(and(eq(items.tenantId, tenantId), eq(items.isActive, true)))
      .orderBy(asc(items.name), asc(items.id)).limit(cap);
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(items)
      .where(and(eq(items.tenantId, tenantId), eq(items.isActive, true)));
    return { rows, total: c?.n ?? 0 };
  });
}

const likeEscape = (s: string): string => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/** Case-insensitive substring search over name and sku. */
export async function searchInventoryItems(tenantId: string, q: string, limit: number): Promise<InvItem[]> {
  const conds: SQL[] = [eq(items.tenantId, tenantId), eq(items.isActive, true)];
  if (q !== "") {
    const pat = `%${likeEscape(q)}%`;
    conds.push(sql`(${items.name} ILIKE ${pat} ESCAPE '\\' OR ${items.sku} ILIKE ${pat} ESCAPE '\\')`);
  }
  return scopedRead((tx) => tx.select(basic).from(items)
    .where(and(...conds)).orderBy(asc(items.name), asc(items.id)).limit(limit));
}
