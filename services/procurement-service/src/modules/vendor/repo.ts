import { and, desc, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
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

export async function listVendorsByTenant(tenantId: string, limit = 100, offset = 0): Promise<VendorRow[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(procurementVendors).where(eq(procurementVendors.tenantId, tenantId)).limit(limit).offset(offset));
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
