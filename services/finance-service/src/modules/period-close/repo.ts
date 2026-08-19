import { eq, and, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { financePeriodClose, financePeriodReopenLog } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findPeriodClose(tenantId: string, period: string) {
  const rows = await scopedRead((tx) => tx.select().from(financePeriodClose).where(and(
    eq(financePeriodClose.tenantId, tenantId),
    eq(financePeriodClose.period, period),
  )).limit(1));
  return rows[0] ?? null;
}

export async function upsertPeriodClose(tx: Writer, row: typeof financePeriodClose.$inferInsert): Promise<void> {
  // M2: atomic ON CONFLICT eliminates the TOCTOU race of the previous
  // read-then-insert pattern. The WHERE guard prevents overwriting a
  // hard_close — if the row is hard-closed the DO UPDATE silently no-ops.
  await (tx as any).execute(sql`
    INSERT INTO gl.finance_period_close (tenant_id, period, fiscal_year, status, closed_by, closed_at)
    VALUES (
      ${row.tenantId}::uuid,
      ${row.period},
      ${row.fiscalYear},
      ${row.status ?? "open"},
      ${row.closedBy ?? null}::uuid,
      ${row.closedAt ?? null}
    )
    ON CONFLICT (tenant_id, fiscal_year, period) DO UPDATE
      SET status    = EXCLUDED.status,
          closed_by = EXCLUDED.closed_by,
          closed_at = EXCLUDED.closed_at
    WHERE gl.finance_period_close.status != 'hard_close'
  `);
}

export async function listPeriodClose(tenantId: string, limit = 50) {
  return scopedRead((tx) => tx.select().from(financePeriodClose)
    .where(eq(financePeriodClose.tenantId, tenantId)).limit(limit));
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

/** Tx-scoped period status — reads inside the caller's transaction so the check is serialised with the write. */
export async function getPeriodStatusTx(tx: any, tenantId: string, period: string): Promise<string> {
  const rows = await tx.select()
    .from(financePeriodClose)
    .where(and(eq(financePeriodClose.tenantId, tenantId), eq(financePeriodClose.period, period)))
    .limit(1);
  return rows[0]?.status ?? "open";
}

export async function logReopen(tx: Writer, row: typeof financePeriodReopenLog.$inferInsert): Promise<void> {
  await tx.insert(financePeriodReopenLog).values(row);
}
