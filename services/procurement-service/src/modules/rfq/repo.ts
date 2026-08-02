import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { procurementRfqs, procurementRfqItems, type RfqRow, type RfqInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
export type RfqItemInsert = typeof procurementRfqItems.$inferInsert;

export async function insertRfq(tx: Writer, row: RfqInsert): Promise<void> {
  await tx.insert(procurementRfqs).values(row);
}

export async function insertRfqItems(tx: Writer, rows: RfqItemInsert[]): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(procurementRfqItems).values(rows);
}

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
