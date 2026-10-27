import { eq, and, count, sql, inArray, ilike, or, desc, type SQL } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { likePattern } from "../../shared/search.js";
import { procurementVendors } from "../vendor/schema.js";
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
 *  stores the bare PO uuid, so strip the prefix before comparing.
 *  Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
 *  before this read — a bare db.execute() runs with no RLS GUC set, and
 *  procurement.three_way_match is FORCE ROW LEVEL SECURITY: an unset GUC
 *  fails CLOSED (always zero rows), not open, so the un-fixed shape here
 *  silently blocked every legitimate payment rather than leaking
 *  cross-tenant data. Mirrors this file's other db.transaction()-wrapped
 *  reads (findGrnById, findGrnItemsByGrnId, findInspectionByGrnId,
 *  countAcceptedGrnsByPoRef) — this was the one missed instance. */
export async function hasMatchedThreeWayWithInvoice(tenantId: string, poRef: string): Promise<boolean> {
  const poId = poRef.replace(/^procurement_po:/, "");
  const result = await db.transaction((tx) => tx.execute(sql`
    SELECT 1 FROM procurement.three_way_match
    WHERE tenant_id = ${tenantId}::uuid
      AND po_id::text = ${poId}
      AND match_status = 'matched'
      AND invoice_id IS NOT NULL
    LIMIT 1
  `));
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

/** GAP-PROCUREMENT-GRN-02: server-side filters for the GRN register. */
export type GrnListFilter = { q?: string; status?: string; vendorId?: string };

/**
 * Pre-decision GRN states: the register counts all of them as "awaiting inspection".
 * The stored `partial` is included because list rows render it as `draft`
 * (queries.mapGrnStatus has no partial), so the cards stay consistent with the rows.
 */
export const GRN_AWAITING_STATUSES = ["draft", "under_inspection", "received", "quality_check", "partial"] as const;

function grnWhere(tenantId: string, f: GrnListFilter): SQL {
  const conds: SQL[] = [eq(procurementGrns.tenantId, tenantId)];
  if (f.vendorId) conds.push(eq(procurementGrns.vendorId, f.vendorId));
  if (f.status) conds.push(eq(procurementGrns.status, f.status));
  if (f.q) {
    const pat = likePattern(f.q);
    // GRN number or vendor name: the vendor lookup is a tenant-scoped subquery so
    // the search reaches GRNs beyond any page the browser already holds.
    const byVendor = sql`${procurementGrns.vendorId} IN (SELECT ${procurementVendors.id} FROM ${procurementVendors} WHERE ${procurementVendors.tenantId} = ${tenantId} AND ${ilike(procurementVendors.name, pat)})`;
    conds.push(or(ilike(procurementGrns.grnNo, pat), byVendor) as SQL);
  }
  return and(...conds) as SQL;
}

export async function listGrnsByTenant(tenantId: string, limit = 100, offset = 0, filter: GrnListFilter = {}): Promise<GrnRow[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  // Newest first, id as tiebreak, so paging by offset is stable.
  return db.transaction((tx) => tx.select().from(procurementGrns)
    .where(grnWhere(tenantId, filter))
    .orderBy(desc(procurementGrns.createdAt), desc(procurementGrns.id))
    .limit(limit)
    .offset(offset));
}

/** GAP-PROCUREMENT-GRN-02: TRUE counts over every GRN matching the filter (not one page). */
export async function countGrnsByStatus(tenantId: string, filter: GrnListFilter = {}): Promise<Array<{ status: string; n: number }>> {
  const rows = await db.transaction((tx) => tx
    .select({ status: procurementGrns.status, n: sql<number>`count(*)::int` })
    .from(procurementGrns)
    .where(grnWhere(tenantId, filter))
    .groupBy(procurementGrns.status));
  return rows.map((r) => ({ status: r.status, n: Number(r.n) }));
}

/**
 * GAP-PROCUREMENT-GRN-NEW-06 - quantity already committed per PO line by the
 * PO's non-rejected GRNs: accepted qty for accepted GRNs, received qty for
 * GRNs still draft/under inspection. `excludeGrnId` leaves out the GRN being
 * amended. Runs inside the caller's transaction (tenant GUC already set).
 */
export async function committedQtyByPoItemTx(
  tx: Writer,
  tenantId: string,
  poId: string,
  excludeGrnId?: string,
): Promise<Map<string, number>> {
  const exclude = excludeGrnId ?? null;
  const rows = await (tx as typeof db).execute(sql`
    SELECT i.po_item_ref AS ref,
           COALESCE(SUM(CASE WHEN g.status = 'accepted' THEN i.accepted_qty
                             WHEN g.status IN ('draft', 'under_inspection') THEN i.received_qty
                             ELSE 0 END), 0)::int AS committed
    FROM grn.procurement_grn_items i
    JOIN grn.procurement_grns g ON g.id = i.grn_id
    WHERE g.tenant_id = ${tenantId}::uuid
      AND g.po_ref IN (${poId}, ${"procurement_po:" + poId})
      AND (${exclude}::uuid IS NULL OR g.id <> ${exclude}::uuid)
    GROUP BY i.po_item_ref
  `);
  const out = new Map<string, number>();
  for (const r of rows as unknown as Array<{ ref: string; committed: number }>) out.set(r.ref, Number(r.committed));
  return out;
}
