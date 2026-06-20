import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { procurementIndents, type IndentRow } from "../indent/schema.js";
import { procurementPos, type PoRow } from "../po/schema.js";

export async function findPendingIndentsByTenant(tenantId: string, limit = 100): Promise<IndentRow[]> {
  return db
    .select()
    .from(procurementIndents)
    .where(and(eq(procurementIndents.tenantId, tenantId), eq(procurementIndents.status, "pending")))
    .limit(limit);
}

export async function findDraftPosByTenant(tenantId: string, limit = 100): Promise<PoRow[]> {
  return db
    .select()
    .from(procurementPos)
    .where(and(eq(procurementPos.tenantId, tenantId), eq(procurementPos.status, "draft")))
    .limit(limit);
}
