import { eq, and, ne, sql, isNull, inArray } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { refundDisbursements, type DisbursementRow, type DisbursementInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<DisbursementRow | null> {
  return scopedRead((tx) => findByIdQuery(tx, id, tenantId));
}

/** Same lookup, scoped to an existing transaction (see `findById`). Use this
 * inside a consumer's own `db.transaction(...)` instead of the plain
 * `findById`, which opens its own separate transaction/connection — fine for
 * an immutable read of a field written earlier in the SAME transaction, but
 * a needless second connection per in-flight message, and a footgun if a
 * future edit ever reads something that isn't yet committed. */
export async function findByIdTx(tx: ScopedTx, id: string, tenantId: string): Promise<DisbursementRow | null> {
  return findByIdQuery(tx, id, tenantId);
}

function findByIdQuery(tx: ScopedTx, id: string, tenantId: string) {
  return tx.select().from(refundDisbursements)
    .where(and(eq(refundDisbursements.id, id), eq(refundDisbursements.tenantId, tenantId)))
    .limit(1)
    .then((rows) => rows[0] ?? null);
}

/**
 * FIN-3 / double-disbursement guard: the only disbursement state that does
 * NOT represent money either in flight or already sent is "failed" (a failed
 * attempt is safe to retry — see reconciliation/routes.ts, which allows a
 * fresh initiate from request status "failed"). This returns the active
 * (non-failed) disbursement for a request, if any, so callers can refuse to
 * create a second one while one is already initiated/processing/completed.
 */
export async function findActiveByRequest(requestId: string, tenantId: string): Promise<DisbursementRow | null> {
  return scopedRead((tx) => findActiveByRequestQuery(tx, requestId, tenantId));
}

/** Same check as `findActiveByRequest`, scoped to an existing transaction so
 * the consumer can re-verify atomically (with respect to its own single,
 * strictly-sequential per-topic poll loop) immediately before inserting. */
export async function findActiveByRequestTx(
  tx: ScopedTx,
  requestId: string,
  tenantId: string,
): Promise<DisbursementRow | null> {
  return findActiveByRequestQuery(tx, requestId, tenantId);
}

function findActiveByRequestQuery(tx: ScopedTx, requestId: string, tenantId: string) {
  return tx.select().from(refundDisbursements)
    .where(and(
      eq(refundDisbursements.requestId, requestId),
      eq(refundDisbursements.tenantId, tenantId),
      ne(refundDisbursements.status, "failed"),
    ))
    .limit(1)
    .then((rows) => rows[0] ?? null);
}

export async function insertDisbursement(tx: ScopedTx, row: DisbursementInsert): Promise<void> {
  await tx.insert(refundDisbursements).values(row);
}

/**
 * RACE-1: same compare-and-swap fix as requests/repo.ts's updateStatus, and
 * for the identical reason — completeDisbursement and failDisbursement
 * publish to two DIFFERENT topics (refund.disbursement.complete /
 * refund.disbursement.fail) with no ordering between their poll loops. The
 * severe concrete case: complete then fail racing on the same disbursement.
 * If complete's consumer commits first (status -> "completed", real money
 * already sent) and fail's consumer was UNCONDITIONAL, it would flip that
 * SAME row to "failed" -- and because findActiveByRequest/the migration
 * 0002 unique index both key off status <> 'failed', and initiateDisbursement
 * treats "failed" as retryable, that reopens the exact request for a brand
 * new, real second disbursement: a genuine double payout. Requiring the row
 * to still be in `allowedFromStatuses` makes this atomic: whichever commits
 * first wins, and the second one's UPDATE matches zero rows.
 */
export async function updateStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  updatedBy: string,
  allowedFromStatuses: string[],
): Promise<boolean> {
  const result = await tx.update(refundDisbursements)
    .set({
      status,
      updatedBy,
      updatedAt: new Date(),
      ...(status === "completed" ? { disbursedAt: new Date() } : {}),
      version: sql`${refundDisbursements.version} + 1`,
    })
    .where(and(
      eq(refundDisbursements.id, id),
      eq(refundDisbursements.tenantId, tenantId),
      inArray(refundDisbursements.status, allowedFromStatuses),
    ))
    .returning({ id: refundDisbursements.id });
  return result.length > 0;
}

/** RACE-1: see `updateStatus` above -- the same compare-and-swap, applied to
 * the fail path specifically (markFailed always sets status to "failed", so
 * there is no `status` parameter to guard, only the allowed source set). */
export async function markFailed(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  reason: string,
  updatedBy: string,
  allowedFromStatuses: string[],
): Promise<boolean> {
  const result = await tx.update(refundDisbursements)
    .set({
      status: "failed",
      failureReason: reason,
      updatedBy,
      updatedAt: new Date(),
      version: sql`${refundDisbursements.version} + 1`,
    })
    .where(and(
      eq(refundDisbursements.id, id),
      eq(refundDisbursements.tenantId, tenantId),
      inArray(refundDisbursements.status, allowedFromStatuses),
    ))
    .returning({ id: refundDisbursements.id });
  return result.length > 0;
}

/**
 * FIN-5 / TOCTOU: reconciliation/routes.ts already checks `reconciledAt` is
 * null before publishing, but that's a SELECT at request time, not an
 * atomic precondition on the write itself. Re-asserting `reconciledAt IS
 * NULL` in the WHERE clause makes the DB itself the source of truth: only
 * the first UPDATE to actually reach Postgres can match, and the caller
 * (reconciliation/consumer.ts) uses the returned boolean to skip the
 * event-enqueue/audit-write on a no-op second call.
 */
export async function reconcile(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  reconciledBy: string,
): Promise<boolean> {
  const result = await tx.update(refundDisbursements)
    .set({
      reconciledAt: new Date(),
      reconciledBy,
      updatedBy: reconciledBy,
      updatedAt: new Date(),
      version: sql`${refundDisbursements.version} + 1`,
    })
    .where(and(
      eq(refundDisbursements.id, id),
      eq(refundDisbursements.tenantId, tenantId),
      isNull(refundDisbursements.reconciledAt),
    ))
    .returning({ id: refundDisbursements.id });
  return result.length > 0;
}
