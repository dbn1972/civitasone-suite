import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { receipts, refunds } from "./schema.js";
import { dcbEntries } from "../assessment/schema.js";
import { eq, and, desc } from "drizzle-orm";
import { SERVICE } from "../../topics.js";

export async function listReceipts(tenantId: string, assesseeId: string, pagination: { limit: number; offset: number }) {
  const rows = await cache.getOrLoad(`${SERVICE}:${tenantId}:receipts:${assesseeId}`, async () => {
    return db
      .select()
      .from(receipts)
      .where(and(eq(receipts.tenantId, tenantId), eq(receipts.assesseeId, assesseeId)))
      .orderBy(desc(receipts.createdAt));
  });
  return rows ?? [];
}

export async function findReceipt(tenantId: string, id: string) {
  const rows = await db
    .select()
    .from(receipts)
    .where(and(eq(receipts.tenantId, tenantId), eq(receipts.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Fetch a single refund by id, tenant-scoped. Used by the maker-checker
 * decide screen so a checker never approves/rejects blind — the caller
 * needs amountMinor + the reason + who raised it before deciding.
 */
export async function findRefundById(tenantId: string, id: string) {
  const rows = await db
    .select()
    .from(refunds)
    .where(and(eq(refunds.tenantId, tenantId), eq(refunds.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Get the current balance for a demand from the latest DCB entry.
 */
export async function getDemandBalance(tenantId: string, demandId: string): Promise<bigint> {
  const rows = await db
    .select({ balanceMinor: dcbEntries.balanceMinor })
    .from(dcbEntries)
    .where(and(eq(dcbEntries.tenantId, tenantId), eq(dcbEntries.demandId, demandId)))
    .orderBy(desc(dcbEntries.createdAt))
    .limit(1);
  return rows[0]?.balanceMinor ?? 0n;
}
