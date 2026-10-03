import { eq, and, isNull, lte, sql, max, SQL } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { scannerDb } from "../../shared/scanner-db.js";
import { assetDepSchedules, assetDepEntries, type DepScheduleInsert, type DepEntryInsert, type DepScheduleRow, type DepEntryRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findScheduleByAsset(assetId: string, tenantId: string, depBook = "company"): Promise<DepScheduleRow | null> {
  // P0-3: with the dual-book schedules (company + statutory) now persisting per
  // asset, scope the lookup by dep_book so this returns a single deterministic
  // schedule instead of an arbitrary one of the two books.
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
  // read — a bare db.select() runs with no RLS GUC set.
  const rows = await scopedRead((tx) => tx.select().from(assetDepSchedules)
    .where(and(
      eq(assetDepSchedules.assetId, assetId),
      eq(assetDepSchedules.tenantId, tenantId),
      eq(assetDepSchedules.depBook, depBook),
    ))
    .limit(1));
  return rows[0] ?? null;
}

export async function findEntriesByAsset(assetId: string, tenantId: string, limit = 500): Promise<DepEntryRow[]> {
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
  // read — a bare db.select() runs with no RLS GUC set.
  return scopedRead((tx) => tx.select().from(assetDepEntries)
    .where(and(eq(assetDepEntries.assetId, assetId), eq(assetDepEntries.tenantId, tenantId)))
    .limit(limit));
}

export async function findDueEntries(tenantId: string, period: string, depBook?: string, limit = 500): Promise<DepEntryRow[]> {
  // P0-3: filter by tenantId. Without it, a depRun for one tenant posts GL for
  // EVERY tenant due in that period.
  const conditions: SQL[] = [eq(assetDepEntries.tenantId, tenantId), eq(assetDepEntries.period, period), isNull(assetDepEntries.postedAt)];
  if (depBook) conditions.push(eq(assetDepEntries.depBook, depBook));
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
  // read — a bare db.select() runs with no RLS GUC set.
  return scopedRead((tx) => tx.select().from(assetDepEntries).where(and(...conditions)).limit(limit));
}

export type PeriodBookSummary = {
  depBook: string; pendingCount: number; pendingMinor: bigint; postedCount: number; postedMinor: bigint; lastPostedAt: Date | null;
};

/**
 * GAP-ASSETS-DEPRECIATION-02: what a run for `period` would do (pending = unposted entries) and what
 * is already posted, per book. Read-only; drives the preview / "already posted" state of the run page.
 */
export async function summarizePeriod(tenantId: string, period: string, depBook?: string): Promise<PeriodBookSummary[]> {
  const conds: SQL[] = [eq(assetDepEntries.tenantId, tenantId), eq(assetDepEntries.period, period)];
  if (depBook) conds.push(eq(assetDepEntries.depBook, depBook));
  const rows = await scopedRead((tx) => tx.select({
    depBook: assetDepEntries.depBook,
    pendingCount: sql<number>`count(*) filter (where ${assetDepEntries.postedAt} is null)::int`,
    pendingMinor: sql<string>`coalesce(sum(${assetDepEntries.amountMinor}) filter (where ${assetDepEntries.postedAt} is null), 0)::text`,
    postedCount: sql<number>`count(*) filter (where ${assetDepEntries.postedAt} is not null)::int`,
    postedMinor: sql<string>`coalesce(sum(${assetDepEntries.amountMinor}) filter (where ${assetDepEntries.postedAt} is not null), 0)::text`,
    lastPostedAt: max(assetDepEntries.postedAt),
  }).from(assetDepEntries).where(and(...conds)).groupBy(assetDepEntries.depBook).orderBy(assetDepEntries.depBook));
  return rows.map((r) => ({
    depBook: r.depBook, pendingCount: r.pendingCount, pendingMinor: BigInt(r.pendingMinor),
    postedCount: r.postedCount, postedMinor: BigInt(r.postedMinor), lastPostedAt: r.lastPostedAt ?? null,
  }));
}

/** The most recent period that has any posted entry (and when it was posted), or null if nothing was ever posted. */
export async function findLastPostedPeriod(tenantId: string): Promise<{ period: string; postedAt: Date } | null> {
  const rows = await scopedRead((tx) => tx.select({ period: assetDepEntries.period, postedAt: max(assetDepEntries.postedAt) })
    .from(assetDepEntries)
    .where(and(eq(assetDepEntries.tenantId, tenantId), sql`${assetDepEntries.postedAt} is not null`))
    .groupBy(assetDepEntries.period)
    .orderBy(sql`${assetDepEntries.period} desc`)
    .limit(1));
  const r = rows[0];
  return r && r.postedAt ? { period: r.period, postedAt: r.postedAt } : null;
}

export async function insertSchedule(tx: Writer, row: DepScheduleInsert): Promise<void> {
  await tx.insert(assetDepSchedules).values(row);
}

export async function upsertEntry(tx: Writer, row: DepEntryInsert): Promise<void> {
  await tx.insert(assetDepEntries).values(row);
}

/**
 * GAP-ASSETS-DEPRECIATION-06: claim an entry for posting. The `posted_at IS NULL`
 * guard makes this a compare-and-set -- when two depRun commands (a manual run
 * and the scheduler tick, or a double submit) race for the same entry, the
 * second UPDATE waits for the first transaction, re-evaluates the guard, matches
 * no row and returns false, so the entry is posted to the GL exactly once.
 */
export async function markEntryPosted(tx: Writer, id: string, tenantId: string, glRef: string, actorId: string): Promise<boolean> {
  const claimed = await (tx as typeof db).update(assetDepEntries)
    .set({ postedAt: new Date(), glRef, updatedAt: new Date(), updatedBy: actorId })
    .where(and(eq(assetDepEntries.id, id), eq(assetDepEntries.tenantId, tenantId), isNull(assetDepEntries.postedAt)))
    .returning({ id: assetDepEntries.id });
  return claimed.length > 0;
}

// P1-1 scheduler support: list (tenantId, period) pairs that still have unposted
// dep entries up to and including the given period. Drives the worker tick so
// monthly depreciation posts automatically, per tenant, without a manual call.
//
// CROSS-TENANT SCAN — runs on the BYPASSRLS scanner pool (shared/scanner-db.ts):
// this background scheduler tick deliberately discovers due (tenantId, period)
// pairs across ALL tenants in one query (see scheduler.ts#runDepScheduleTick,
// which then emits a per-tenant depRun command for each pair). Under the
// NOBYPASSRLS asset_svc role (#146) a bare cross-tenant SELECT returns zero
// rows, so the scan uses scannerDb; all resulting writes are consumed under
// runWithTenant(tenantId) so RLS still applies to every mutation.
export async function findDueTenantPeriods(uptoPeriod: string): Promise<Array<{ tenantId: string; period: string }>> {
  const rows = await scannerDb
    .selectDistinct({ tenantId: assetDepEntries.tenantId, period: assetDepEntries.period })
    .from(assetDepEntries)
    .where(and(isNull(assetDepEntries.postedAt), lte(assetDepEntries.period, uptoPeriod)));
  return rows.map((r) => ({ tenantId: r.tenantId, period: r.period }));
}
