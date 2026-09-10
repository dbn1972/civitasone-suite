import { eq, and, count, sql, inArray } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { procurementGrns, procurementGrnItems, procurementInspections, type GrnRow, type GrnInsert, type GrnItemInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findGrnById(id: string): Promise<GrnRow | null> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) => tx.select().from(procurementGrns).where(eq(procurementGrns.id, id)).limit(1));
  return rows[0] ?? null;
}

export async function findGrnByIdTx(tx: Writer, id: string): Promise<GrnRow | null> {
  const rows = await (tx as typeof db).select().from(procurementGrns).where(eq(procurementGrns.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findGrnItemsByGrnTx(tx: Writer, grnId: string): Promise<(typeof procurementGrnItems.$inferSelect)[]> {
  return (tx as typeof db).select().from(procurementGrnItems).where(eq(procurementGrnItems.grnId, grnId));
}

export async function findInspectionByGrnTx(tx: Writer, grnId: string): Promise<(typeof procurementInspections.$inferSelect) | null> {
  const rows = await (tx as typeof db).select().from(procurementInspections).where(eq(procurementInspections.grnId, grnId)).limit(1);
  return rows[0] ?? null;
}

export async function findGrnItemsByGrnId(grnId: string): Promise<(typeof procurementGrnItems.$inferSelect)[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(procurementGrnItems).where(eq(procurementGrnItems.grnId, grnId)));
}

/**
 * PERF-019 batch loader: was one COUNT-via-fetched-rows query per GRN (N+1,
 * in grn/queries.ts::listGrns, via Promise.all(findGrnItemsByGrnId)). Now a
 * single grouped-count query across all GRN ids, mirroring PERF-005 tranche
 * 1's ai-fraud/routes.ts ghost-employee fix (SQL COUNT/GROUP BY instead of
 * fetched-then-counted). Returns a Map keyed by grnId; a GRN with 0 items is
 * simply absent — callers should default to 0 on a miss.
 */
export async function countItemsByGrnIds(grnIds: string[]): Promise<Map<string, number>> {
  const byGrn = new Map<string, number>();
  if (grnIds.length === 0) return byGrn;
  const rows = await db.transaction((tx) => tx
    .select({ grnId: procurementGrnItems.grnId, count: sql<number>`count(*)::int` })
    .from(procurementGrnItems)
    .where(inArray(procurementGrnItems.grnId, grnIds))
    .groupBy(procurementGrnItems.grnId));
  for (const row of rows) byGrn.set(row.grnId, row.count);
  return byGrn;
}

export async function findInspectionByGrnId(grnId: string): Promise<(typeof procurementInspections.$inferSelect) | null> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) => tx.select().from(procurementInspections).where(eq(procurementInspections.grnId, grnId)).limit(1));
  return rows[0] ?? null;
}

/** Count accepted GRNs linked to a PO reference (poRef or po id). */
export async function countAcceptedGrnsByPoRef(tenantId: string, poRef: string): Promise<number> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) => tx.select({ cnt: count() }).from(procurementGrns).where(and(
    eq(procurementGrns.tenantId, tenantId),
    eq(procurementGrns.poRef, poRef),
    eq(procurementGrns.status, "accepted"),
  )));
  return Number(rows[0]?.cnt ?? 0);
}

/** Check three_way_match table for a matched record with invoice. The payment
 *  gate passes a poRef that may carry a `procurement_po:` prefix; three_way_match
 *  stores the bare PO uuid, so strip the prefix before comparing. */
export async function hasMatchedThreeWayWithInvoice(tenantId: string, poRef: string): Promise<boolean> {
  const poId = poRef.replace(/^procurement_po:/, "");
  const result = await db.execute(sql`
    SELECT 1 FROM procurement.three_way_match
    WHERE tenant_id = ${tenantId}::uuid
      AND po_id::text = ${poId}
      AND match_status = 'matched'
      AND invoice_id IS NOT NULL
    LIMIT 1
  `);
  return (result as unknown as { length: number }).length > 0;
}

export async function insertGrn(tx: Writer, row: GrnInsert): Promise<void> {
  await tx.insert(procurementGrns).values(row);
}

export async function updateGrn(tx: Writer, id: string, patch: Partial<GrnInsert>): Promise<void> {
  await tx.update(procurementGrns).set({ ...patch, updatedAt: new Date() }).where(eq(procurementGrns.id, id));
}

export async function insertGrnItems(tx: Writer, items: GrnItemInsert[]): Promise<void> {
  if (items.length) await tx.insert(procurementGrnItems).values(items);
}

/** Req 1.2 — amend a single GRN line's received/accepted quantities. */
export async function updateGrnItemQty(
  tx: Writer,
  lineId: string,
  grnId: string,
  patch: { receivedQty: number; acceptedQty: number; updatedBy: string },
): Promise<void> {
  await (tx as typeof db).update(procurementGrnItems)
    .set({
      receivedQty: patch.receivedQty,
      acceptedQty: patch.acceptedQty,
      updatedBy: patch.updatedBy,
      updatedAt: new Date(),
    })
    .where(and(eq(procurementGrnItems.id, lineId), eq(procurementGrnItems.grnId, grnId)));
}

export async function insertInspection(tx: Writer, row: typeof procurementInspections.$inferInsert): Promise<void> {
  await tx.insert(procurementInspections).values(row);
}

export async function listGrnsByTenant(tenantId: string, limit = 100, offset = 0): Promise<GrnRow[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(procurementGrns)
    .where(eq(procurementGrns.tenantId, tenantId))
    .limit(limit)
    .offset(offset));
}
