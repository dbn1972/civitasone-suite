/**
 * ST-M01-11 — posting/DDO history repo (SmartTransfer OS).
 *
 * Two operations:
 *   - insertPostingTx: the guarded write the consumer runs inside its one
 *     transaction (idempotent via ON CONFLICT on the event id).
 *   - findAsOf: the "as-of" read backing GET …?asOf=YYYY-MM-DD — the single
 *     posting row with the greatest effective_from on/before the given date for
 *     one employee. Runs inside a tenant-scoped transaction so FORCE RLS (not
 *     just the WHERE) enforces tenant isolation.
 */
import { and, desc, eq, lte, sql } from "drizzle-orm";
import type { db } from "../../shared/db.js";
import { scopedRead } from "../../shared/db.js";
import { postingHistory, type PostingHistoryInsert, type PostingHistoryRow } from "./schema.js";

type Writer = Pick<typeof db, "insert" | "select">;

/**
 * Append a posting-history row. Idempotent on (tenant_id, event_id): a
 * redelivery of the same posting event conflicts on the UNIQUE and writes
 * nothing. Returns true when a row was actually inserted (so the caller only
 * records an audit event for a genuine first delivery).
 */
export async function insertPostingTx(
  tx: Writer,
  row: PostingHistoryInsert,
): Promise<boolean> {
  const inserted = await (tx as typeof db)
    .insert(postingHistory)
    .values(row)
    .onConflictDoNothing({
      target: [postingHistory.tenantId, postingHistory.eventId],
    })
    .returning({ id: postingHistory.id });
  return inserted.length > 0;
}

/**
 * The posting effective for an employee as of `asOf` (YYYY-MM-DD): the row with
 * the greatest effective_from that is on/before `asOf`. Returns undefined when
 * the employee had no posting on/before that date. Tenant-scoped by RLS.
 */
export async function findAsOf(
  tenantId: string,
  employeeId: string,
  asOf: string,
): Promise<PostingHistoryRow | undefined> {
  return scopedRead(async (tx) => {
    const rows = await (tx as unknown as typeof db)
      .select()
      .from(postingHistory)
      .where(
        and(
          eq(postingHistory.tenantId, tenantId),
          eq(postingHistory.employeeId, employeeId),
          lte(postingHistory.effectiveFrom, asOf),
        ),
      )
      .orderBy(desc(postingHistory.effectiveFrom), desc(postingHistory.createdAt))
      .limit(1);
    return rows[0];
  });
}

/**
 * The full posting history for an employee (most recent first), tenant-scoped.
 * Used by the as-of API when no asOf is supplied (current + prior postings).
 */
export async function findHistory(
  tenantId: string,
  employeeId: string,
): Promise<PostingHistoryRow[]> {
  return scopedRead(async (tx) => {
    return (tx as unknown as typeof db)
      .select()
      .from(postingHistory)
      .where(
        and(
          eq(postingHistory.tenantId, tenantId),
          eq(postingHistory.employeeId, employeeId),
        ),
      )
      .orderBy(desc(postingHistory.effectiveFrom), desc(postingHistory.createdAt));
  });
}

/** Count rows for a tenant/employee (test + internal use); tenant-scoped. */
export async function countForEmployee(
  tenantId: string,
  employeeId: string,
): Promise<number> {
  return scopedRead(async (tx) => {
    const rows = (await (tx as unknown as { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }).execute(
      sql`SELECT count(*)::int AS c FROM payroll.posting_history
          WHERE tenant_id = ${tenantId}::uuid AND employee_id = ${employeeId}::uuid`,
    )) as unknown as Array<{ c: number }>;
    return rows[0]?.c ?? 0;
  });
}
