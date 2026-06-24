import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { financePeriodClose } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findPeriodClose(tenantId: string, period: string) {
  const rows = await db.select().from(financePeriodClose).where(and(
    eq(financePeriodClose.tenantId, tenantId),
    eq(financePeriodClose.period, period),
  )).limit(1);
  return rows[0] ?? null;
}

export async function upsertPeriodClose(tx: Writer, row: typeof financePeriodClose.$inferInsert): Promise<void> {
  const existing = await findPeriodClose(row.tenantId, row.period);
  if (existing) {
    const patch: Partial<typeof financePeriodClose.$inferInsert> = {
      closedBy: row.closedBy ?? null,
      closedAt: row.closedAt ?? null,
    };
    if (row.status !== undefined) patch.status = row.status;
    await tx.update(financePeriodClose).set(patch).where(eq(financePeriodClose.id, existing.id));
  } else {
    await tx.insert(financePeriodClose).values(row);
  }
}

export async function listPeriodClose(tenantId: string, limit = 50) {
  return db.select().from(financePeriodClose)
    .where(eq(financePeriodClose.tenantId, tenantId)).limit(limit);
}

export async function isPeriodHardClosedDb(tenantId: string, period: string): Promise<boolean> {
  const row = await findPeriodClose(tenantId, period);
  return row?.status === "hard_close";
}

/** Period status: 'open' | 'soft_close' | 'hard_close'. */
export async function getPeriodStatusDb(tenantId: string, period: string): Promise<string> {
  const row = await findPeriodClose(tenantId, period);
  return row?.status ?? "open";
}
