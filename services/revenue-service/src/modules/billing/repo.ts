import { tenantTransaction } from "@civitasone/db";
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { bills } from "./schema.js";
import { eq, and } from "drizzle-orm";
import { SERVICE } from "../../topics.js";

/**
 * Uncached, tenant-scoped lookup of the bill already issued for an assessment
 * (the consumer issues at most one per assessment — uq_bills_tenant_assessment).
 * Deliberately bypasses the list cache: the duplicate check must see a bill
 * the moment it exists.
 */
export async function findBillByAssessment(tenantId: string, assessmentId: string) {
  const rows = await tenantTransaction(db, tenantId, async (tx) => {
    const t = tx as typeof db;
    return t
      .select({ id: bills.id, billNo: bills.billNo })
      .from(bills)
      .where(and(eq(bills.tenantId, tenantId), eq(bills.assessmentId, assessmentId)))
      .limit(1);
  });
  return rows[0] ?? null;
}

export async function listBills(tenantId: string, assesseeId: string, pagination: { limit: number; offset: number }) {
  const rows = await cache.getOrLoad(`${SERVICE}:${tenantId}:bills:${assesseeId}`, async () => {
    return tenantTransaction(db, tenantId, async (tx) => {
      const t = tx as typeof db;
      return t.select().from(bills).where(and(eq(bills.tenantId, tenantId), eq(bills.assesseeId, assesseeId)));
    });
  }) ?? [];
  return {
    data: rows.slice(pagination.offset, pagination.offset + pagination.limit),
    total: rows.length,
  };
}
