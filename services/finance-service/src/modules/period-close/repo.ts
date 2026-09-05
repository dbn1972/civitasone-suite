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

/**
 * Tx-scoped variant of findPeriodClose: reads through the caller's already-open
 * transaction. finance.period.close / finance.period.reopen call this from
 * inside their own db.transaction(); calling the scopedRead-based
 * findPeriodClose there would open a second, nested transaction competing for
 * an extra pool connection while the outer one is already held — under load
 * (pool.max concurrent in-flight commands) that is a total, silent deadlock.
 * Returns the full row (unlike getPeriodStatusTx below, which only needs the
 * status) since callers here also need `id` for the upsert.
 */
export async function findPeriodCloseTx(tx: Writer, tenantId: string, period: string) {
  const rows = await (tx as typeof db).select().from(financePeriodClose).where(and(
    eq(financePeriodClose.tenantId, tenantId),
    eq(financePeriodClose.period, period),
  )).limit(1);
  return rows[0] ?? null;
}

export async function upsertPeriodClose(tx: Writer, row: typeof financePeriodClose.$inferInsert): Promise<void> {
  // M2: atomic ON CONFLICT eliminates the TOCTOU race of the previous
  // read-then-insert pattern. The WHERE guard prevents overwriting a
  // hard_close — if the row is hard-closed the DO UPDATE silently no-ops.
  //
  // BUG FIX: closedAt arrives as a live JS `Date` (or null, on reopen) from
  // period-close/consumer.ts. Unlike drizzle's typed column builders, this raw
  // `sql` template's param path does not accept a bare Date object here — it
  // reached the driver as-is and blew up with
  // `TypeError [ERR_INVALID_ARG_TYPE]: The "string" argument must be of type
  // string...Received an instance of Date`, so this INSERT never once
  // succeeded. Serialise to an ISO string and cast explicitly, matching the
  // established convention for raw-sql timestamptz params elsewhere in the
  // monorepo (e.g. workflow-service/src/modules/external-tasks/repo.ts's
  // `lockExpiresIso`).
  const closedAtIso = row.closedAt ? new Date(row.closedAt).toISOString() : null;
  await (tx as any).execute(sql`
    INSERT INTO gl.finance_period_close (tenant_id, period, fiscal_year, status, closed_by, closed_at)
    VALUES (
      ${row.tenantId}::uuid,
      ${row.period},
      ${row.fiscalYear},
      ${row.status ?? "open"},
      ${row.closedBy ?? null}::uuid,
      ${closedAtIso}::timestamptz
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
