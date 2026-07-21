import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { procurementRfqs, procurementRfqItems, type RfqRow } from "./schema.js";

export async function findRfqById(id: string): Promise<RfqRow | null> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) => tx.select().from(procurementRfqs).where(eq(procurementRfqs.id, id)).limit(1));
  return rows[0] ?? null;
}

export async function listRfqsByTenant(tenantId: string, limit: number, offset: number): Promise<RfqRow[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(procurementRfqs)
    .where(eq(procurementRfqs.tenantId, tenantId))
    .limit(limit)
    .offset(offset));
}

export async function findRfqItemsByRfq(rfqId: string): Promise<(typeof procurementRfqItems.$inferSelect)[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(procurementRfqItems).where(eq(procurementRfqItems.rfqId, rfqId)));
}
