/**
 * items repo — Drizzle queries against the `inventory` schema ONLY.
 * Every read is tenant-scoped; updates are optimistic-locked on `version`.
 */
import { eq, and, sql, type SQL } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { DomainError } from "../../shared/domain.js";
import {
  items, categories, uoms,
  type ItemInsert, type ItemRow, type ItemView,
  type CategoryInsert, type CategoryRow,
  type UomInsert, type UomRow,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

const itemViewColumns = {
  id: items.id,
  tenantId: items.tenantId,
  name: items.name,
  sku: items.sku,
  status: items.status,
  categoryId: items.categoryId,
  category: categories.name,
  uomId: items.uomId,
  uom: uoms.symbol,
  itemType: items.itemType,
  reorderLevel: items.reorderLevel,
  reorderQty: items.reorderQty,
  valuationMethod: items.valuationMethod,
  unitCostMinor: items.unitCostMinor,
  currency: items.currency,
  isActive: items.isActive,
  version: items.version,
} as const;

type RawItemView = Omit<ItemView, "unitCostMinor"> & { unitCostMinor: bigint | null };

function toView(r: RawItemView): ItemView {
  return { ...r, unitCostMinor: (r.unitCostMinor ?? 0n).toString() };
}

// ── Items ──────────────────────────────────────────────────────────────────

export async function insertItem(tx: Writer, row: ItemInsert): Promise<void> {
  await tx.insert(items).values(row);
}

/**
 * Optimistic-locked update: only mutates the row when its current `version`
 * matches `expectedVersion`, bumping the version atomically. Throws
 * VERSION_CONFLICT when the row moved on (or NOT_FOUND when absent for tenant).
 */
export async function updateItemChecked(
  tx: Writer,
  id: string,
  tenantId: string,
  expectedVersion: number,
  patch: Partial<Omit<ItemInsert, "id" | "tenantId" | "version" | "createdAt" | "createdBy">>,
  actorId: string,
): Promise<ItemRow> {
  const updated = await (tx as typeof db)
    .update(items)
    .set({ ...patch, updatedBy: actorId, updatedAt: new Date(), version: sql`${items.version} + 1` })
    .where(and(eq(items.id, id), eq(items.tenantId, tenantId), eq(items.version, expectedVersion)))
    .returning();
  if (updated.length > 0) return updated[0]!;

  const exists = await (tx as typeof db).select({ v: items.version })
    .from(items).where(and(eq(items.id, id), eq(items.tenantId, tenantId))).limit(1);
  if (exists.length === 0) throw new DomainError("NOT_FOUND", `item ${id} not found for tenant`);
  throw new DomainError("VERSION_CONFLICT", `item ${id} expected version ${expectedVersion}, found ${exists[0]!.v}`);
}

export async function findItemRow(id: string, tenantId: string): Promise<ItemRow | null> {
  const rows = await db.select().from(items)
    .where(and(eq(items.id, id), eq(items.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findItemView(id: string, tenantId: string): Promise<ItemView | null> {
  const rows = await db.select(itemViewColumns).from(items)
    .leftJoin(categories, eq(items.categoryId, categories.id))
    .leftJoin(uoms, eq(items.uomId, uoms.id))
    .where(and(eq(items.id, id), eq(items.tenantId, tenantId)))
    .limit(1);
  return rows[0] ? toView(rows[0] as RawItemView) : null;
}

export async function listItemViews(
  tenantId: string,
  opts: { categoryId?: string; status?: string; limit: number; offset: number },
): Promise<ItemView[]> {
  const conds: SQL[] = [eq(items.tenantId, tenantId)];
  if (opts.categoryId) conds.push(eq(items.categoryId, opts.categoryId));
  if (opts.status) conds.push(eq(items.status, opts.status));
  const rows = await db.select(itemViewColumns).from(items)
    .leftJoin(categories, eq(items.categoryId, categories.id))
    .leftJoin(uoms, eq(items.uomId, uoms.id))
    .where(and(...conds))
    .limit(opts.limit)
    .offset(opts.offset);
  return rows.map((r) => toView(r as RawItemView));
}

// ── Categories ──────────────────────────────────────────────────────────────

export async function insertCategory(tx: Writer, row: CategoryInsert): Promise<void> {
  await tx.insert(categories).values(row);
}

export async function listCategories(tenantId: string, limit: number, offset: number): Promise<CategoryRow[]> {
  return db.select().from(categories)
    .where(eq(categories.tenantId, tenantId))
    .limit(limit).offset(offset);
}

// ── UoMs ──────────────────────────────────────────────────────────────────

export async function insertUom(tx: Writer, row: UomInsert): Promise<void> {
  await tx.insert(uoms).values(row);
}

export async function listUoms(tenantId: string, limit: number, offset: number): Promise<UomRow[]> {
  return db.select().from(uoms)
    .where(eq(uoms.tenantId, tenantId))
    .limit(limit).offset(offset);
}

export { toView };
