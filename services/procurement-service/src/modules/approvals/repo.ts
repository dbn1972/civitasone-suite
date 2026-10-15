import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { procurementIndents, type IndentRow } from "../indent/schema.js";
import { procurementPos, procurementPoAmendments, type PoRow } from "../po/schema.js";

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

// GAP-PROCUREMENT-APPROVALS-05/07: batch lookups backing the approvals queue's
// ref-summaries (amount / requester / parent PO). Tenant-scoped; one query per
// kind so a page of tasks never fans out into N+1 reads.
export async function findIndentsByIds(tenantId: string, ids: string[]): Promise<IndentRow[]> {
  if (ids.length === 0) return [];
  return db.transaction((tx) => tx.select().from(procurementIndents)
    .where(and(eq(procurementIndents.tenantId, tenantId), inArray(procurementIndents.id, ids))));
}

export async function findPosByIds(tenantId: string, ids: string[]): Promise<PoRow[]> {
  if (ids.length === 0) return [];
  return db.transaction((tx) => tx.select().from(procurementPos)
    .where(and(eq(procurementPos.tenantId, tenantId), inArray(procurementPos.id, ids))));
}

export async function findAmendmentsByIds(tenantId: string, ids: string[]) {
  if (ids.length === 0) return [];
  return db.transaction((tx) => tx.select().from(procurementPoAmendments)
    .where(and(eq(procurementPoAmendments.tenantId, tenantId), inArray(procurementPoAmendments.id, ids))));
}
