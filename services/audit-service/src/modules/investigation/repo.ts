import { and, eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { investigations, type InvestigationRow } from "./schema.js";

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
