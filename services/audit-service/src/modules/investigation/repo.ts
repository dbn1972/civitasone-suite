import { and, eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { investigations, type InvestigationRow, type InvestigationInsert } from "./schema.js";

export async function listInvestigations(tenantId: string, limit = 50, offset = 0): Promise<InvestigationRow[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(investigations)
    .where(eq(investigations.tenantId, tenantId))
    .limit(limit)
    .offset(offset));
}

export async function listInvestigationsCount(tenantId: string): Promise<number> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) => tx.select({ count: sql<number>`count(*)::int` }).from(investigations)
    .where(eq(investigations.tenantId, tenantId)));
  return rows[0]?.count ?? 0;
}

export async function findInvestigationById(id: string, tenantId: string): Promise<InvestigationRow | null> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) => tx.select().from(investigations)
    .where(and(eq(investigations.id, id), eq(investigations.tenantId, tenantId)))
    .limit(1));
  return rows[0] ?? null;
}

/** Optimistic-locked, tenant-scoped update. Returns rows affected (0 = stale version / not found). */
export async function updateInvestigationVersioned(
  tx: Pick<typeof db, "update">, id: string, tenantId: string, expectedVersion: number, patch: Partial<InvestigationInsert>,
): Promise<number> {
  const res = await tx.update(investigations)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(investigations.id, id), eq(investigations.tenantId, tenantId), eq(investigations.version, expectedVersion)))
    .returning({ id: investigations.id });
  return res.length;
}

export async function findInvestigationByIdTx(tx: Pick<typeof db, "select">, id: string, tenantId: string): Promise<InvestigationRow | null> {
  const rows = await tx.select().from(investigations)
    .where(and(eq(investigations.id, id), eq(investigations.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}
