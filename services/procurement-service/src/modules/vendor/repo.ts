import { and, asc, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { likePattern } from "../../shared/search.js";
import { procurementVendors, procurementEmpanelment, type VendorRow, type VendorInsert } from "./schema.js";
import { procurementVendorScorecards } from "./scorecard-schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findVendorById(id: string, tenantId: string): Promise<VendorRow | null> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) => tx.select().from(procurementVendors)
    .where(and(eq(procurementVendors.id, id), eq(procurementVendors.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

export async function findVendorByIdTx(tx: Writer, id: string, tenantId: string): Promise<VendorRow | null> {
  const rows = await (tx as typeof db).select().from(procurementVendors)
    .where(and(eq(procurementVendors.id, id), eq(procurementVendors.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

/**
 * PERF-005: batch loader for rfq/queries.ts::getRfqDetail, which previously
 * called findVendorById once per response row (N+1). Tenant-scoped like
 * findVendorById; returns a Map keyed by vendor id so callers doing a
 * per-response lookup after this single query become an O(1) Map.get().
 */
export async function findVendorsByIds(ids: string[], tenantId: string): Promise<Map<string, VendorRow>> {
  const byId = new Map<string, VendorRow>();
  if (ids.length === 0) return byId;
  const rows = await db.transaction((tx) => tx.select().from(procurementVendors)
    .where(and(inArray(procurementVendors.id, ids), eq(procurementVendors.tenantId, tenantId))));
  for (const row of rows) byId.set(row.id, row);
  return byId;
}

export async function listVendorsByTenant(tenantId: string, limit = 100, offset = 0, q?: string): Promise<VendorRow[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  // GAP-PROCUREMENT-GRN-NEW-04 / CONTRACTS-NEW-05: optional name search so a
  // picker can reach vendors beyond the first page. Ordered by name when
  // searching so the best-known prefix matches are stable.
  if (q) {
    return db.transaction((tx) => tx.select().from(procurementVendors)
      .where(and(eq(procurementVendors.tenantId, tenantId), ilike(procurementVendors.name, likePattern(q))))
      .orderBy(asc(procurementVendors.name)).limit(limit).offset(offset));
  }
  return db.transaction((tx) => tx.select().from(procurementVendors).where(eq(procurementVendors.tenantId, tenantId)).limit(limit).offset(offset));
}

/** GAP-PROCUREMENT-VENDORS-03: whole-tenant vendor count per vendor_type. */
export async function countVendorsByType(tenantId: string): Promise<Array<{ vendorType: string; n: number }>> {
  const rows = await db.transaction((tx) => tx
    .select({ vendorType: procurementVendors.vendorType, n: sql<number>`COUNT(*)` })
    .from(procurementVendors)
    .where(eq(procurementVendors.tenantId, tenantId))
    .groupBy(procurementVendors.vendorType));
  return rows.map((r) => ({ vendorType: r.vendorType, n: Number(r.n) }));
}

export type DuplicateVendor = { id: string; name: string; field: "gstin" | "pan" };

/**
 * GAP-PROCUREMENT-VENDORS-NEW-02 / NEW-06: existing vendor in this tenant that
 * already carries the same GSTIN or PAN. GSTIN is stored in clear, so it is an
 * exact match. PAN is encrypted at rest (non-deterministic ciphertext, no blind
 * index), so it cannot be matched in SQL directly; characters 3-12 of a GSTIN
 * ARE the PAN, so a PAN is matched against the GSTINs on file. A vendor
 * registered with a PAN only (no GSTIN) is therefore not caught - tracked as a
 * remainder in the PR (needs a blind-index column).
 */
export async function findDuplicateVendorTx(
  tx: Writer, tenantId: string, ids: { gstin?: string | null; pan?: string | null },
): Promise<DuplicateVendor | null> {
  const t = tx as typeof db;
  if (ids.gstin) {
    const hit = await t.select({ id: procurementVendors.id, name: procurementVendors.name }).from(procurementVendors)
      .where(and(eq(procurementVendors.tenantId, tenantId), eq(procurementVendors.gstin, ids.gstin))).limit(1);
    if (hit[0]) return { ...hit[0], field: "gstin" };
  }
  const pan = ids.pan ?? (ids.gstin ? ids.gstin.slice(2, 12) : null);
  if (pan && /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
    const hit = await t.select({ id: procurementVendors.id, name: procurementVendors.name }).from(procurementVendors)
      .where(and(eq(procurementVendors.tenantId, tenantId), sql`substr(${procurementVendors.gstin}, 3, 10) = ${pan}`)).limit(1);
    if (hit[0]) return { ...hit[0], field: "pan" };
  }
  return null;
}

export async function findDuplicateVendor(tenantId: string, ids: { gstin?: string | null; pan?: string | null }): Promise<DuplicateVendor | null> {
  return db.transaction((tx) => findDuplicateVendorTx(tx, tenantId, ids));
}

export async function insertVendor(tx: Writer, row: VendorInsert): Promise<void> {
  await tx.insert(procurementVendors).values(row);
}

export async function updateVendor(tx: Writer, id: string, patch: Partial<VendorInsert>): Promise<void> {
  await tx.update(procurementVendors).set({ ...patch, updatedAt: new Date() }).where(eq(procurementVendors.id, id));
}

/** Optimistic-locked vendor update (#16): fails on stale `expectedVersion`. */
export async function updateVendorVersioned(tx: Writer, id: string, expectedVersion: number, patch: Partial<VendorInsert>): Promise<void> {
  const res = await (tx as typeof db).update(procurementVendors)
    .set({ ...patch, version: expectedVersion + 1, updatedAt: new Date() })
    .where(and(eq(procurementVendors.id, id), eq(procurementVendors.version, expectedVersion)))
    .returning({ id: procurementVendors.id });
  if (res.length === 0) {
    throw new Error(`OPTIMISTIC_LOCK_CONFLICT: vendor ${id} was modified concurrently (expected version ${expectedVersion})`);
  }
}

export async function insertEmpanelment(tx: Writer, row: typeof procurementEmpanelment.$inferInsert): Promise<void> {
  await tx.insert(procurementEmpanelment).values(row);
}

/** Suspend every ACTIVE empanelment of a vendor; returns how many rows changed. */
export async function suspendActiveEmpanelmentsTx(tx: Writer, vendorId: string, tenantId: string, actorId: string): Promise<number> {
  const res = await (tx as typeof db).update(procurementEmpanelment)
    .set({ status: "suspended", updatedBy: actorId, updatedAt: new Date() })
    .where(and(
      eq(procurementEmpanelment.vendorId, vendorId),
      eq(procurementEmpanelment.tenantId, tenantId),
      eq(procurementEmpanelment.status, "active"),
    ))
    .returning({ id: procurementEmpanelment.id });
  return res.length;
}

export type EmpanelmentListRow = {
  id: string;
  vendorName: string;
  category: string;
  validUntil: string | null;
  status: string;
  overallRating: number | null;
};

/**
 * Empanelment register joined with vendor name + the vendor's all-time
 * scorecard rating (SVC-049) — no fabricated rating; 0/null when the vendor
 * has no computed scorecard yet.
 */
/**
 * GAP2-PROCUREMENT-EMPANELMENT-02 / GAP2-PROCUREMENT-GAPLIST-03: true row
 * count over the tenant-filtered empanelment set (same WHERE as the list, no
 * limit/offset) so meta.total is the dataset size, not the capped page length.
 */
export async function countEmpanelmentsByTenant(tenantId: string): Promise<number> {
  const rows = await db.transaction((tx) => tx
    .select({ n: sql<number>`COUNT(*)` })
    .from(procurementEmpanelment)
    .innerJoin(procurementVendors, and(
      eq(procurementEmpanelment.vendorId, procurementVendors.id),
      eq(procurementVendors.tenantId, tenantId),
    ))
    .where(eq(procurementEmpanelment.tenantId, tenantId)));
  return Number(rows[0]?.n ?? 0);
}

export async function listEmpanelmentsByTenant(tenantId: string, limit: number, offset: number): Promise<EmpanelmentListRow[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx
    .select({
      id: procurementEmpanelment.id,
      vendorName: procurementVendors.name,
      category: procurementEmpanelment.category,
      validUntil: procurementEmpanelment.validUntil,
      status: procurementEmpanelment.status,
      overallRating: procurementVendorScorecards.overallRating,
    })
    .from(procurementEmpanelment)
    .innerJoin(procurementVendors, and(
      eq(procurementEmpanelment.vendorId, procurementVendors.id),
      eq(procurementVendors.tenantId, tenantId),
    ))
    .leftJoin(procurementVendorScorecards, and(
      eq(procurementVendorScorecards.vendorId, procurementEmpanelment.vendorId),
      eq(procurementVendorScorecards.tenantId, tenantId),
      eq(procurementVendorScorecards.period, "all"),
    ))
    .where(eq(procurementEmpanelment.tenantId, tenantId))
    .orderBy(desc(procurementEmpanelment.createdAt))
    .limit(limit)
    .offset(offset));
}

/** Empanelment rows for one vendor (tenant-scoped); for the PO eligibility gate. */
export async function findEmpanelmentsByVendor(
  vendorId: string,
  tenantId: string,
): Promise<Array<{ status: string; validUntil: string | null }>> {
  return db.transaction((tx) => tx
    .select({ status: procurementEmpanelment.status, validUntil: procurementEmpanelment.validUntil })
    .from(procurementEmpanelment)
    .where(and(eq(procurementEmpanelment.vendorId, vendorId), eq(procurementEmpanelment.tenantId, tenantId))));
}

export async function findEmpanelmentsByVendorTx(
  tx: Writer,
  vendorId: string,
  tenantId: string,
): Promise<Array<{ status: string; validUntil: string | null }>> {
  return (tx as typeof db)
    .select({ status: procurementEmpanelment.status, validUntil: procurementEmpanelment.validUntil })
    .from(procurementEmpanelment)
    .where(and(eq(procurementEmpanelment.vendorId, vendorId), eq(procurementEmpanelment.tenantId, tenantId)));
}
