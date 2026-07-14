import { eq, asc, and, gte, lte, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { transitionHistory, type TransitionInsert, type TransitionRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "select">;

/** Append a transition record. Insert-only; the table trigger blocks updates/deletes. */
export async function record(tx: Writer, row: Omit<TransitionInsert, "id" | "createdAt">): Promise<void> {
  await tx.insert(transitionHistory).values(row);
}

export async function listForInstance(instanceId: string, tenantId: string): Promise<TransitionRow[]> {
  return scopedRead((tx) => tx.select().from(transitionHistory)
    .where(and(eq(transitionHistory.instanceId, instanceId), eq(transitionHistory.tenantId, tenantId)))
    .orderBy(asc(transitionHistory.createdAt)));
}

/**
 * Gap 6 — audit export. Tenant-scoped, date-ranged transition_history for RTI /
 * audit. Keyset-paginated by (created_at, id) so a stream/large export never
 * skips or duplicates rows across pages. `from`/`to` are inclusive ISO bounds.
 * Returns up to `limit` rows after the (afterCreatedAt, afterId) cursor.
 */
export async function exportForTenant(
  tenantId: string,
  from: Date,
  to: Date,
  limit: number,
  afterCreatedAt: Date | null,
  afterId: string | null,
): Promise<TransitionRow[]> {
  const conds = [
    eq(transitionHistory.tenantId, tenantId),
    gte(transitionHistory.createdAt, from),
    lte(transitionHistory.createdAt, to),
  ];
  if (afterCreatedAt && afterId) {
    // Keyset cursor. created_at is truncated to milliseconds on BOTH sides so a
    // millisecond-precision ISO cursor round-trips losslessly against the
    // microsecond-precision column (otherwise the boundary row repeats).
    conds.push(
      sql`(date_trunc('milliseconds', ${transitionHistory.createdAt}), ${transitionHistory.id}) > (date_trunc('milliseconds', ${afterCreatedAt.toISOString()}::timestamptz), ${afterId})`,
    );
  }
  return scopedRead((tx) => tx.select().from(transitionHistory)
    .where(and(...conds))
    .orderBy(sql`date_trunc('milliseconds', ${transitionHistory.createdAt})`, asc(transitionHistory.id))
    .limit(limit));
}
