/**
 * QP-002 — price book reads/writes.
 * All money stays a bigint end to end; nothing here produces a `number`.
 */
import { eq, and, sql, desc, asc, inArray, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import {
  priceBooks,
  priceBookEntries,
  type PriceBookRow,
  type PriceBookInsert,
  type PriceBookEntryRow,
  type PriceBookEntryInsert,
} from "./schema.js";

// ─── Price books ───────────────────────────────────────────────────────────────

export interface PriceBookListFilters {
  tenantId: string;
  limit: number;
  offset: number;
  status?: string | undefined;
  segment?: string | undefined;
  currency?: string | undefined;
}

export async function listPriceBooks(filters: PriceBookListFilters): Promise<{ rows: PriceBookRow[]; total: number }> {
  const conditions: SQL[] = [eq(priceBooks.tenantId, filters.tenantId)];
  if (filters.status !== undefined) conditions.push(eq(priceBooks.status, filters.status));
  if (filters.segment !== undefined) conditions.push(eq(priceBooks.segment, filters.segment));
  if (filters.currency !== undefined) conditions.push(eq(priceBooks.currency, filters.currency));
  const where = and(...conditions)!;

  const [rows, cnt] = await scopedRead(async (tx) => {
    const data = await tx.select().from(priceBooks).where(where)
      .orderBy(desc(priceBooks.effectiveFrom)).limit(filters.limit).offset(filters.offset);
    const total = await tx.select({ count: sql<number>`count(*)::int` }).from(priceBooks).where(where);
    return [data, total] as const;
  });
  return { rows, total: cnt[0]?.count ?? 0 };
}

export async function findPriceBookById(id: string, tenantId: string): Promise<PriceBookRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(priceBooks)
      .where(and(eq(priceBooks.id, id), eq(priceBooks.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function insertPriceBook(tx: ScopedTx, row: PriceBookInsert): Promise<void> {
  await tx.insert(priceBooks).values(row);
}

/** Optimistic-locked update. Returns false when no row matched → 409. */
export async function updatePriceBook(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  patch: Partial<PriceBookInsert>,
  expectedVersion: number,
): Promise<boolean> {
  const result = await tx.update(priceBooks)
    .set({ ...patch, updatedAt: new Date(), version: sql`${priceBooks.version} + 1` })
    .where(and(eq(priceBooks.id, id), eq(priceBooks.tenantId, tenantId), eq(priceBooks.version, expectedVersion)))
    .returning({ id: priceBooks.id });
  return result.length > 0;
}

/** Books eligible to price a product in a segment + currency (resolve path). */
export async function listBooksForResolve(tenantId: string, segment: string, currency: string): Promise<PriceBookRow[]> {
  return scopedRead((tx) =>
    tx.select().from(priceBooks)
      .where(and(
        eq(priceBooks.tenantId, tenantId),
        eq(priceBooks.segment, segment),
        eq(priceBooks.currency, currency),
        eq(priceBooks.status, "active"),
      ))
      .orderBy(desc(priceBooks.effectiveFrom)),
  );
}

// ─── Price book entries ────────────────────────────────────────────────────────

export async function listEntries(
  priceBookId: string,
  tenantId: string,
  limit: number,
  offset: number,
): Promise<{ rows: PriceBookEntryRow[]; total: number }> {
  const where = and(eq(priceBookEntries.tenantId, tenantId), eq(priceBookEntries.priceBookId, priceBookId))!;
  const [rows, cnt] = await scopedRead(async (tx) => {
    const data = await tx.select().from(priceBookEntries).where(where)
      .orderBy(asc(priceBookEntries.productId)).limit(limit).offset(offset);
    const total = await tx.select({ count: sql<number>`count(*)::int` }).from(priceBookEntries).where(where);
    return [data, total] as const;
  });
  return { rows, total: cnt[0]?.count ?? 0 };
}

/**
 * Bulk replace a book's entries. UNIQUE (tenant_id, price_book_id, product_id)
 * means a replace is the only safe way to express "this is the whole book".
 */
export async function replaceEntries(
  tx: ScopedTx,
  priceBookId: string,
  tenantId: string,
  rows: PriceBookEntryInsert[],
): Promise<number> {
  await tx.delete(priceBookEntries)
    .where(and(eq(priceBookEntries.tenantId, tenantId), eq(priceBookEntries.priceBookId, priceBookId)));
  if (rows.length === 0) return 0;
  await tx.insert(priceBookEntries).values(rows);
  return rows.length;
}

/** Entries for one product across a set of candidate books (resolve path). */
export async function listEntriesForProduct(
  tenantId: string,
  productId: string,
  bookIds: readonly string[],
): Promise<PriceBookEntryRow[]> {
  if (bookIds.length === 0) return [];
  return scopedRead((tx) =>
    tx.select().from(priceBookEntries)
      .where(and(
        eq(priceBookEntries.tenantId, tenantId),
        eq(priceBookEntries.productId, productId),
        inArray(priceBookEntries.priceBookId, [...bookIds]),
      )),
  );
}
