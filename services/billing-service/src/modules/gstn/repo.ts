import { and, desc, eq } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { billingGstnReturns, type BillingGstnReturnInsert, type BillingGstnReturnRow } from "./schema.js";

/** Record a filed return. Idempotent on (tenant, reference): a replay of the same reference is a no-op. */
export async function insertReturn(row: BillingGstnReturnInsert): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(billingGstnReturns).values(row).onConflictDoNothing({ target: [billingGstnReturns.tenantId, billingGstnReturns.referenceId] });
  });
}

/** Keep the stored status in step with the latest GSTN status lookup (tenant-scoped by RLS and the WHERE). */
export async function updateStatusByReference(tenantId: string, referenceId: string, status: string, actorId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(billingGstnReturns)
      .set({ status, updatedBy: actorId, updatedAt: new Date() })
      .where(and(eq(billingGstnReturns.tenantId, tenantId), eq(billingGstnReturns.referenceId, referenceId)));
  });
}

export interface ReturnFilter { gstin?: string | undefined; period?: string | undefined; returnType?: string | undefined; limit: number }

export async function listReturns(tenantId: string, f: ReturnFilter): Promise<BillingGstnReturnRow[]> {
  const conds = [eq(billingGstnReturns.tenantId, tenantId)];
  if (f.gstin) conds.push(eq(billingGstnReturns.gstin, f.gstin));
  if (f.period) conds.push(eq(billingGstnReturns.returnPeriod, f.period));
  if (f.returnType) conds.push(eq(billingGstnReturns.returnType, f.returnType));
  return scopedRead((tx) => tx.select().from(billingGstnReturns).where(and(...conds)).orderBy(desc(billingGstnReturns.filedAt)).limit(f.limit));
}
