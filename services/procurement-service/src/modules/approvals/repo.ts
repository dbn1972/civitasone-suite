import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { procurementIndents, type IndentRow } from "../indent/schema.js";
import { procurementPos, type PoRow } from "../po/schema.js";

export async function findPendingIndentsByTenant(tenantId: string, limit = 100): Promise<IndentRow[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx
    .select()
    .from(procurementIndents)
    .where(and(eq(procurementIndents.tenantId, tenantId), eq(procurementIndents.status, "pending")))
    .limit(limit));
}

export async function findDraftPosByTenant(tenantId: string, limit = 100): Promise<PoRow[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx
    .select()
    .from(procurementPos)
    .where(and(eq(procurementPos.tenantId, tenantId), eq(procurementPos.status, "draft")))
    .limit(limit));
}
