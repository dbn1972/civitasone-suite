import { eq, and, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { revenueLedger, revenueAccruals } from "./schema.js";
import type { RevenueLedgerView, RevenueAccrualView } from "./domain.js";

function toLedgerView(row: typeof revenueLedger.$inferSelect): RevenueLedgerView {
  return {
    id: row.id,
    tenantId: row.tenantId,
    subscriptionId: row.subscriptionId,
    totalAmountPaise: row.totalAmountPaise.toString(),
    servicePeriodStart: row.servicePeriodStart,
    servicePeriodEnd: row.servicePeriodEnd,
    totalDays: row.totalDays,
    recognizedPaise: row.recognizedPaise.toString(),
    deferredPaise: row.deferredPaise.toString(),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toAccrualView(row: typeof revenueAccruals.$inferSelect): RevenueAccrualView {
  return {
    id: row.id,
    ledgerId: row.ledgerId,
    accrualDate: row.accrualDate,
    amountPaise: row.amountPaise.toString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getLedgerById(tenantId: string, id: string): Promise<RevenueLedgerView | null> {
  return cache.getOrLoad(
    cache.makeKey(tenantId, "revenue-ledger", id),
    async () => {
      const rows = await db
        .select()
        .from(revenueLedger)
        .where(and(eq(revenueLedger.id, id), eq(revenueLedger.tenantId, tenantId)));
      return rows[0] ? toLedgerView(rows[0]) : null;
    },
  );
}

export async function listLedgers(
  tenantId: string,
  page: number,
  pageSize: number,
): Promise<{ data: RevenueLedgerView[]; meta: { page: number; pageSize: number; total: number } }> {
  const offset = (page - 1) * pageSize;
  const rows = await db
    .select()
    .from(revenueLedger)
    .where(eq(revenueLedger.tenantId, tenantId))
    .orderBy(desc(revenueLedger.createdAt))
    .limit(pageSize)
    .offset(offset);

  // Count total for pagination meta
  const countRows = await db
    .select()
    .from(revenueLedger)
    .where(eq(revenueLedger.tenantId, tenantId));

  return {
    data: rows.map(toLedgerView),
    meta: { page, pageSize, total: countRows.length },
  };
}

export async function getAccrualsForLedger(
  tenantId: string,
  ledgerId: string,
): Promise<RevenueAccrualView[]> {
  const rows = await db
    .select()
    .from(revenueAccruals)
    .where(and(eq(revenueAccruals.ledgerId, ledgerId), eq(revenueAccruals.tenantId, tenantId)))
    .orderBy(revenueAccruals.accrualDate);
  return rows.map(toAccrualView);
}
