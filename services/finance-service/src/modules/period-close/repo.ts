import { eq, and, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { financePeriodClose, financePeriodReopenLog } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/**
 * DOM-010: a period string must have the shape of an actual accounting
 * period (YYYY-MM, month 01-12) before its status is even looked up.
 * getPeriodStatusDb/getPeriodStatusTx below used to fall back to "open" for
 * ANY period with no finance_period_close row — including a malformed or
 * garbled period (e.g. derived by slicing a bad postingDate) that was never
 * a real period to begin with. That let a bogus period sail through as if
 * it were a legitimately-open one. A well-formed period with simply no
 * close record yet is still correctly "open" (nobody has closed it) and is
 * unaffected by this check.
 */
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

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
  // CONCURRENCY FIX: see lockPeriodTx's doc comment below (getPeriodStatusTx
  // takes the same lock on the read side). Closes the postJournal-vs-hard-
  // close race: a concurrent post's transaction is now guaranteed to either
  // fully commit before this write is applied, or fully block until this
  // write's transaction ends.
  await lockPeriodTx(tx as any, row.tenantId, row.period);
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
  // BUG FIX (accounting-critical #1): the live table (created by
  // 0005_world_class.sql — see schema.ts's createdBy doc comment) requires
  // created_by NOT NULL with no default. Every caller already has an actor id
  // available (msg.actorId) to pass through `row.createdBy`; on the ON
  // CONFLICT DO UPDATE path this value is constructed but never applied (the
  // SET list below doesn't touch created_by, so an existing row keeps its
  // original creator) — it still must be a valid non-null UUID for the
  // INSERT's proposed row to satisfy the NOT NULL constraint, which Postgres
  // enforces before conflict resolution is even reached.
  await (tx as any).execute(sql`
    INSERT INTO gl.finance_period_close (tenant_id, period, fiscal_year, status, closed_by, closed_at, created_by)
    VALUES (
      ${row.tenantId}::uuid,
      ${row.period},
      ${row.fiscalYear},
      ${row.status ?? "open"},
      ${row.closedBy ?? null}::uuid,
      ${closedAtIso}::timestamptz,
      ${row.createdBy}::uuid
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

/** Period status: 'open' | 'soft_close' | 'hard_close' | 'unknown'. */
export async function getPeriodStatusDb(tenantId: string, period: string): Promise<string> {
  if (!PERIOD_RE.test(period)) return "unknown";
  const row = await findPeriodClose(tenantId, period);
  return row?.status ?? "open";
}

/**
 * Serialises period-status reads against period-status writes with a
 * transaction-scoped Postgres advisory lock keyed on (tenant, period).
 *
 * THE RACE: postJournal (gl/consumer.ts) calls getPeriodStatusTx() once,
 * early, inside its own already-open transaction, then goes on to do
 * substantial further work (idempotency check, gapless voucher allocation,
 * leaf-account guard, budget check) before it ever commits, with no re-check
 * of period status immediately before that commit. A concurrent
 * finance.period.close (hard_close) can run its own upsertPeriodClose and
 * commit in the gap between postJournal's early check and its own later
 * commit, so a journal can post successfully into a period that is, by the
 * time it lands, already hard-closed. Proven live: 6 pending journals
 * approved concurrently with a hard-close (genuine Promise.all, not
 * sequential) left 5 of 6 journals with a posted timestamp AFTER the
 * period's closed_at.
 *
 * WHY NOT PLAIN `SELECT ... FOR UPDATE`: a period can go from its very
 * first-ever activity straight to closed with ZERO pre-existing
 * finance_period_close row (see getPeriodStatusDb's doc comment above — "a
 * well-formed period with simply no close record yet is still correctly
 * open"; period-close/consumer.ts's `existing?.id ?? crypto.randomUUID()`
 * confirms the row is created lazily on first close, never pre-seeded). A
 * row-level FOR UPDATE lock has nothing to lock until a row exists, and
 * cannot block a reader on a row a concurrent, still-uncommitted transaction
 * is in the middle of inserting — Postgres's MVCC visibility rules mean an
 * uncommitted INSERT simply isn't there yet from the reader's point of view,
 * FOR UPDATE or not. A session-level advisory lock has no such gap: it is
 * keyed purely on (tenant_id, period), independent of whether any row
 * backing it exists, so it serialises the very first close against a
 * concurrent post just as reliably as the hundredth.
 *
 * `_xact` scoping means Postgres releases the lock automatically at commit
 * OR rollback — no manual unlock, no risk of leaking it on an error path,
 * and its lifetime matches the surrounding transaction exactly (the same
 * requirement nextVoucherNo's row lock has, hoa/voucher.ts).
 *
 * Called from both sides of the race: getPeriodStatusTx below (read side,
 * the status check inside postJournal's transaction) and upsertPeriodClose
 * above (write side, called by finance.period.close's hard_close/soft_close
 * and finance.period.reopen). Whichever transaction reaches this call first
 * for a given (tenant, period) runs to completion — commit or rollback —
 * before the other proceeds past it, so a hard-close and a concurrent post
 * can never interleave: either the post's transaction fully commits before
 * the close is applied, or the close fully commits first and the post's
 * (now-unblocked) status read sees hard_close and is rejected in postJournal
 * exactly as it already is for a non-concurrent hard-close.
 *
 * MUST be called from inside the caller's own already-open transaction (same
 * requirement as getPeriodStatusTx/findPeriodCloseTx above) — opening a
 * fresh one here would hit the identical nested-transaction pool exhaustion
 * this file already warns about.
 *
 * Exported (not just called internally by upsertPeriodClose above) so
 * period-close/consumer.ts's finance.period.close/reopen handlers can also
 * acquire it explicitly, early — as the very first thing after markProcessed,
 * before they compute `closedAt: new Date()` or read the existing row. Taking
 * it a second time in the same transaction inside upsertPeriodClose is a
 * harmless no-op (Postgres advisory-lock acquisition is reentrant per
 * session/transaction: a transaction that already holds a given key's lock
 * always succeeds immediately on re-acquiring it). The reason to take it
 * early rather than rely solely on upsertPeriodClose's own call: closedAt is
 * a JS `new Date()` computed by the caller, not a DB-side `now()` — if it
 * were computed BEFORE a lock wait (i.e., before this function), a
 * hard-close blocked behind an in-flight post would record its OWN
 * pre-wait attempt time as closed_at, which can sort earlier than that
 * post's own (correctly late-computed, see gl/repo.ts's postJournal
 * persistence step) updated_at — a false-looking "posted after close"
 * even though the post legitimately committed first and the close only
 * took effect afterward. Locking first makes closedAt reflect the moment
 * this transaction actually got exclusive access to the period, i.e. its
 * true effective-close time.
 */
export async function lockPeriodTx(tx: any, tenantId: string, period: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${period}))`);
}

/** Tx-scoped period status — reads inside the caller's transaction so the check is serialised with the write. */
export async function getPeriodStatusTx(tx: any, tenantId: string, period: string): Promise<string> {
  if (!PERIOD_RE.test(period)) return "unknown";
  await lockPeriodTx(tx, tenantId, period);
  const rows = await tx.select()
    .from(financePeriodClose)
    .where(and(eq(financePeriodClose.tenantId, tenantId), eq(financePeriodClose.period, period)))
    .limit(1);
  return rows[0]?.status ?? "open";
}

export async function logReopen(tx: Writer, row: typeof financePeriodReopenLog.$inferInsert): Promise<void> {
  await tx.insert(financePeriodReopenLog).values(row);
}
