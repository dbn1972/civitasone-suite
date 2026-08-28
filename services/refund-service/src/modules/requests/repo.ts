import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { refundRequests, type RefundRequestRow, type RefundRequestInsert } from "./schema.js";

/**
 * Cache key for the read-through GET /v1/refund/requests/:id cache (see
 * requests/routes.ts). Centralized here so every consumer that mutates a
 * request (this module's own, plus processing/ and reconciliation/, which
 * both import this repo as `reqRepo`) invalidates the exact same key the
 * route reads through.
 */
export function cacheKey(tenantId: string, id: string): string {
  return `refund:${tenantId}:request:${id}`;
}

export async function findById(id: string, tenantId: string): Promise<RefundRequestRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(refundRequests)
      .where(and(eq(refundRequests.id, id), eq(refundRequests.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function findByNumber(requestNumber: string, tenantId: string): Promise<RefundRequestRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(refundRequests)
      .where(and(eq(refundRequests.requestNumber, requestNumber), eq(refundRequests.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: RefundRequestRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const conditions = [eq(refundRequests.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(refundRequests.status, opts.status));

  const rows = await scopedRead((tx) =>
    tx.select().from(refundRequests)
      .where(and(...conditions))
      .orderBy(desc(refundRequests.createdAt))
      .limit(pageSize)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(refundRequests)
      .where(and(...conditions)),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertRequest(tx: ScopedTx, row: RefundRequestInsert): Promise<void> {
  await tx.insert(refundRequests).values(row);
}

/**
 * RACE-1: this WHERE clause used to be id+tenantId only, with no precondition
 * on the row's CURRENT status. That is a real gap, not a theoretical one: two
 * different action types (e.g. approve vs. reject, or approve vs. withdraw)
 * publish to two DIFFERENT command topics, and each topic runs its own
 * independent, unsynchronized poll loop (see SqsQueue.start in
 * services/queue-service/src/bus.ts, which pushes one pollTopic() per topic
 * with no ordering between them) — so two calls submitted a normal HTTP
 * round-trip apart, not nanoseconds apart, can both pass their own
 * route-level pre-check before either command is consumed, and this
 * function would previously apply whichever one's consumer happened to run
 * LAST, silently overwriting a legitimate rejection/withdrawal with a later
 * approval (or vice versa).
 *
 * `allowedFromStatuses` makes this an atomic compare-and-swap: the row only
 * updates if it is STILL in one of the states this transition is actually
 * valid from, checked via the returned row count exactly like
 * reconciliation/repo.ts's reconcile() already does for reconciledAt. Every
 * call site must pass this explicitly (no default) so a future new caller
 * can't accidentally skip the guard.
 */
export async function updateStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  updatedBy: string,
  allowedFromStatuses: string[],
): Promise<boolean> {
  const result = await tx.update(refundRequests)
    .set({
      status,
      updatedBy,
      updatedAt: new Date(),
      ...(status === "under_review" ? { submittedAt: new Date() } : {}),
      version: sql`${refundRequests.version} + 1`,
    })
    .where(and(
      eq(refundRequests.id, id),
      eq(refundRequests.tenantId, tenantId),
      inArray(refundRequests.status, allowedFromStatuses),
    ))
    .returning({ id: refundRequests.id });
  return result.length > 0;
}
