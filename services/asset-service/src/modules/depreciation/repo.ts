import { eq, and, isNull, lte, SQL } from "drizzle-orm";
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

export async function insertSchedule(tx: Writer, row: DepScheduleInsert): Promise<void> {
  await tx.insert(assetDepSchedules).values(row);
}

export async function upsertEntry(tx: Writer, row: DepEntryInsert): Promise<void> {
  await tx.insert(assetDepEntries).values(row);
}

export async function markEntryPosted(tx: Writer, id: string, tenantId: string, glRef: string, actorId: string): Promise<void> {
  await (tx as typeof db).update(assetDepEntries)
    .set({ postedAt: new Date(), glRef, updatedAt: new Date(), updatedBy: actorId })
    .where(and(eq(assetDepEntries.id, id), eq(assetDepEntries.tenantId, tenantId)));
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
