/**
 * ivr repo — DB queries for IVR hits. Tenant-scoped on every operation.
 *
 * The count/max-ordinal readers accept an optional caller-supplied transaction:
 * the consumer must read them inside the same transaction it inserts in, so the
 * ordinal it assigns cannot be based on state that has since moved.
 */
import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { withTenantScope } from "@civitasone/db";
import { ivrHits, type IvrHitRow, type IvrHitInsert, type IvrHitView } from "./schema.js";

function toView(r: IvrHitRow): IvrHitView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    callId: r.callId,
    menuKey: r.menuKey,
    digit: r.digit,
    timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : String(r.timestamp),
    ordinal: r.ordinal,
  };
}

/** A drizzle transaction or the root db — anything that can run a select. */
export type Reader = Pick<typeof db, "select">;

function inScope<T>(tenantId: string, tx: Reader | undefined, fn: (r: Reader) => Promise<T>): Promise<T> {
  if (tx) return fn(tx);
  return withTenantScope(db, tenantId, (scoped) => fn(scoped as Reader)) as Promise<T>;
}

/** Count existing IVR hits for a given call. */
export async function countByCall(tenantId: string, callId: string, tx?: Reader): Promise<number> {
  return inScope(tenantId, tx, async (r) => {
    const rows = await r
      .select({ count: sql<number>`count(*)::int` })
      .from(ivrHits)
      .where(and(eq(ivrHits.tenantId, tenantId), eq(ivrHits.callId, callId)));
    return rows[0]?.count ?? 0;
  });
}

/** Get the max ordinal for a call (for assigning the next ordinal). */
export async function maxOrdinal(tenantId: string, callId: string, tx?: Reader): Promise<number> {
  return inScope(tenantId, tx, async (r) => {
    const rows = await r
      .select({ max: sql<number>`coalesce(max(${ivrHits.ordinal}), 0)::int` })
      .from(ivrHits)
      .where(and(eq(ivrHits.tenantId, tenantId), eq(ivrHits.callId, callId)));
    return rows[0]?.max ?? 0;
  });
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/** Insert multiple IVR hits in a batch. */
export async function insertBatch(tx: Writer, rows: IvrHitInsert[]): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(ivrHits).values(rows);
}

/** List all IVR hits for a call, ordered by ordinal. */
export async function listByCall(tenantId: string, callId: string): Promise<IvrHitView[]> {
  return withTenantScope(db, tenantId, async (tx) => {
    const rows = await (tx as typeof db)
      .select()
      .from(ivrHits)
      .where(and(eq(ivrHits.tenantId, tenantId), eq(ivrHits.callId, callId)))
      .orderBy(ivrHits.ordinal);
    return rows.map(toView);
  }) as Promise<IvrHitView[]>;
}
