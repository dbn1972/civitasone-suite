/**
 * items repo — Drizzle queries against the `inventory` schema ONLY.
 * Every read is tenant-scoped; updates are optimistic-locked on `version`.
 */
import { eq, and, sql, type SQL } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { DomainError } from "../../shared/domain.js";
import {
  items, categories, uoms, itemSubstitutes, bins, custodians, reservations, goodsReturns,
  type ItemInsert, type ItemRow, type ItemView,
  type CategoryInsert, type CategoryRow,
  type UomInsert, type UomRow,
  type ItemSubstituteRow, type ItemSubstituteInsert,
  type BinRow, type BinInsert,
  type CustodianRow, type CustodianInsert,
  type ReservationRow, type ReservationInsert,
  type GoodsReturnRow, type GoodsReturnInsert,
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
  reorderMax: items.reorderMax,
  valuationMethod: items.valuationMethod,
  unitCostMinor: items.unitCostMinor,
  currency: items.currency,
  isActive: items.isActive,
  hsnCode: items.hsnCode,
  gstRate: items.gstRate,
  taxClass: items.taxClass,
  shelfLifeDays: items.shelfLifeDays,
  requiresBatchTracking: items.requiresBatchTracking,
  requiresSerialTracking: items.requiresSerialTracking,
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
  const rows = await scopedRead((tx) => tx.select().from(items)
    .where(and(eq(items.id, id), eq(items.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

export async function findItemView(id: string, tenantId: string): Promise<ItemView | null> {
  const rows = await scopedRead((tx) => tx.select(itemViewColumns).from(items)
    .leftJoin(categories, eq(items.categoryId, categories.id))
    .leftJoin(uoms, eq(items.uomId, uoms.id))
    .where(and(eq(items.id, id), eq(items.tenantId, tenantId)))
    .limit(1));
  return rows[0] ? toView(rows[0] as RawItemView) : null;
}

export async function listItemViews(
  tenantId: string,
  opts: { categoryId?: string; status?: string; limit: number; offset: number },
): Promise<ItemView[]> {
  const conds: SQL[] = [eq(items.tenantId, tenantId)];
  if (opts.categoryId) conds.push(eq(items.categoryId, opts.categoryId));
  if (opts.status) conds.push(eq(items.status, opts.status));
  const rows = await scopedRead((tx) => tx.select(itemViewColumns).from(items)
    .leftJoin(categories, eq(items.categoryId, categories.id))
    .leftJoin(uoms, eq(items.uomId, uoms.id))
    .where(and(...conds))
    .limit(opts.limit)
    .offset(opts.offset));
  return rows.map((r) => toView(r as RawItemView));
}

// ── Categories ──────────────────────────────────────────────────────────────

export async function insertCategory(tx: Writer, row: CategoryInsert): Promise<void> {
  await tx.insert(categories).values(row);
}

export async function listCategories(tenantId: string, limit: number, offset: number): Promise<CategoryRow[]> {
  return scopedRead((tx) => tx.select().from(categories)
    .where(eq(categories.tenantId, tenantId))
    .limit(limit).offset(offset));
}

export async function findCategory(tenantId: string, id: string): Promise<CategoryRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(categories)
    .where(and(eq(categories.id, id), eq(categories.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

export async function updateCategory(
  id: string,
  tenantId: string,
  patch: Partial<Omit<CategoryInsert, "id" | "tenantId" | "createdAt" | "createdBy">>,
  actorId: string,
): Promise<CategoryRow> {
  // Wrap in db.transaction() so wrapWithTenantGuc sets app.tenant_id GUC (required by FORCE RLS).
  const rows = await db.transaction(async (tx) =>
    (tx as unknown as typeof db).update(categories)
      .set({ ...patch, updatedBy: actorId, updatedAt: new Date(), version: sql`${categories.version} + 1` })
      .where(and(eq(categories.id, id), eq(categories.tenantId, tenantId)))
      .returning(),
  );
  if (rows.length === 0) throw new DomainError("NOT_FOUND", `category ${id} not found for tenant`);
  return rows[0]!;
}

// ── UoMs ──────────────────────────────────────────────────────────────────

export async function insertUom(tx: Writer, row: UomInsert): Promise<void> {
  await tx.insert(uoms).values(row);
}

export async function listUoms(tenantId: string, limit: number, offset: number): Promise<UomRow[]> {
  return scopedRead((tx) => tx.select().from(uoms)
    .where(eq(uoms.tenantId, tenantId))
    .limit(limit).offset(offset));
}

export async function findUom(tenantId: string, id: string): Promise<UomRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(uoms)
    .where(and(eq(uoms.id, id), eq(uoms.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

export async function updateUom(
  id: string,
  tenantId: string,
  patch: Partial<Omit<UomInsert, "id" | "tenantId" | "createdAt" | "createdBy">>,
  actorId: string,
): Promise<UomRow> {
  // Wrap in db.transaction() so wrapWithTenantGuc sets app.tenant_id GUC (required by FORCE RLS).
  const rows = await db.transaction(async (tx) =>
    (tx as unknown as typeof db).update(uoms)
      .set({ ...patch, updatedBy: actorId, updatedAt: new Date(), version: sql`${uoms.version} + 1` })
      .where(and(eq(uoms.id, id), eq(uoms.tenantId, tenantId)))
      .returning(),
  );
  if (rows.length === 0) throw new DomainError("NOT_FOUND", `uom ${id} not found for tenant`);
  return rows[0]!;
}

// ── Substitutes (SVC-051) ──────────────────────────────────────────────────

export async function insertSubstitute(tx: Writer, row: ItemSubstituteInsert): Promise<void> {
  await tx.insert(itemSubstitutes).values(row);
}

export async function listSubstitutes(tenantId: string, itemId: string): Promise<ItemSubstituteRow[]> {
  return scopedRead((tx) => tx.select().from(itemSubstitutes)
    .where(and(eq(itemSubstitutes.tenantId, tenantId), eq(itemSubstitutes.itemId, itemId))));
}

// ── Bins/Rack (SVC-052) ────────────────────────────────────────────────────

export async function insertBin(tx: Writer, row: BinInsert): Promise<void> {
  await tx.insert(bins).values(row);
}

export async function listBins(tenantId: string, limit: number, offset: number): Promise<BinRow[]> {
  return scopedRead((tx) => tx.select().from(bins)
    .where(eq(bins.tenantId, tenantId))
    .limit(limit).offset(offset));
}

// ── Reservations (SVC-054) ─────────────────────────────────────────────────

export async function insertReservation(tx: Writer, row: ReservationInsert): Promise<void> {
  await tx.insert(reservations).values(row);
}

export async function releaseReservation(
  tx: Writer,
  id: string,
  tenantId: string,
  expectedVersion: number,
  actorId: string,
): Promise<void> {
  const updated = await (tx as typeof db)
    .update(reservations)
    .set({ status: "released", updatedBy: actorId, updatedAt: new Date(), version: sql`${reservations.version} + 1` })
    .where(and(eq(reservations.id, id), eq(reservations.tenantId, tenantId), eq(reservations.version, expectedVersion), eq(reservations.status, "active")))
    .returning();
  if (updated.length === 0) throw new DomainError("RESERVATION_RELEASE_FAILED", `reservation ${id} not found, already released, or version conflict`);
}

export async function listReservations(tenantId: string, limit: number, offset: number): Promise<ReservationRow[]> {
  return scopedRead((tx) => tx.select().from(reservations)
    .where(and(eq(reservations.tenantId, tenantId), eq(reservations.status, "active")))
    .limit(limit).offset(offset));
}

/** Sum of active reservations for an item at a store (used by issue validation). */
export async function sumReservedQty(tenantId: string, itemId: string, storeId: string): Promise<number> {
  const result = await scopedRead((tx) => tx.select({ total: sql<number>`COALESCE(SUM(${reservations.qty}), 0)` })
    .from(reservations)
    .where(and(eq(reservations.tenantId, tenantId), eq(reservations.itemId, itemId), eq(reservations.storeId, storeId), eq(reservations.status, "active"))));
  return Number(result[0]?.total ?? 0);
}

// ── Goods Returns + QC (SVC-053) ───────────────────────────────────────────

export async function insertGoodsReturn(tx: Writer, row: GoodsReturnInsert): Promise<void> {
  await tx.insert(goodsReturns).values(row);
}

export async function updateGoodsReturnQc(
  tx: Writer,
  id: string,
  tenantId: string,
  patch: { qcStatus: string; qcInspectedBy: string; qcInspectedAt: Date; qcNotes?: string; disposition: string },
): Promise<void> {
  const updated = await (tx as typeof db)
    .update(goodsReturns)
    .set({ ...patch, updatedAt: new Date(), updatedBy: patch.qcInspectedBy, version: sql`${goodsReturns.version} + 1` })
    .where(and(eq(goodsReturns.id, id), eq(goodsReturns.tenantId, tenantId), eq(goodsReturns.qcStatus, "pending")))
    .returning();
  if (updated.length === 0) throw new DomainError("QC_NOT_PENDING", `goods return ${id} is not pending inspection`);
}

export async function listGoodsReturns(tenantId: string, limit: number, offset: number): Promise<GoodsReturnRow[]> {
  return scopedRead((tx) => tx.select().from(goodsReturns)
    .where(eq(goodsReturns.tenantId, tenantId))
    .limit(limit).offset(offset));
}

export { toView };
