/**
 * bulk_scan repository for the review / filing / link / retention / search waves. Same rules as repo.ts: ONLY the
 * bulk_scan schema, reads via scopedRead (tenant GUC + explicit tenant_id filter), writes take a transaction handle
 * and are called only from consumers / worker jobs (never from route files).
 */
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { batchFiles, batches, links, type BatchFileRow, type LinkRow } from "./schema.js";
import type { Writer } from "./repo.js";
import type { FileState } from "./state.js";
import { getPorts } from "./ports.js";

// ── review queue ────────────────────────────────────────────────

export async function listReviewQueue(
  tenantId: string, o: { limit: number; offset: number; reason?: string | undefined },
): Promise<{ rows: Array<BatchFileRow & { batchName: string | null }>; total: number }> {
  // LIKE prefix for the parameterised form (built outside the sql`` template: it is a bind parameter, not SQL text)
  const reasonPrefix = o.reason ? `${o.reason.replace(/[\\%_]/g, "\\$&")}:%` : "";
  const where = and(
    eq(batchFiles.tenantId, tenantId), eq(batchFiles.state, "needs_review"),
    // exact reason code, or a parameterised one (MISSING_FIELD:date matches MISSING_FIELD)
    o.reason
      ? sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(${batchFiles.reviewReasons}, '[]'::jsonb)) r(v) WHERE r.v = ${o.reason} OR r.v LIKE ${reasonPrefix})`
      : undefined,
  );
  return scopedRead(async (tx) => {
    const rows = await tx.select({ f: batchFiles, batchName: batches.name }).from(batchFiles)
      .leftJoin(batches, and(eq(batches.id, batchFiles.batchId), eq(batches.tenantId, batchFiles.tenantId)))
      .where(where).orderBy(asc(batchFiles.updatedAt), asc(batchFiles.id)).limit(o.limit).offset(o.offset);
    const t = await tx.select({ n: count() }).from(batchFiles).where(where);
    return { rows: rows.map((r) => ({ ...r.f, batchName: r.batchName })), total: Number(t[0]?.n ?? 0) };
  });
}

export async function getFileByDocumentId(tenantId: string, documentId: string): Promise<BatchFileRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(batchFiles).where(and(eq(batchFiles.tenantId, tenantId), eq(batchFiles.filedDocumentId, documentId))).limit(1));
  return rows[0] ?? null;
}

/**
 * Non-state update of a file under optimistic concurrency: applies `set` only if the file is still in one of
 * `states` AND at `expectedVersion`. Returns false when someone else changed it first.
 */
export async function patchFileVersioned(
  tx: Writer,
  a: { tenantId: string; fileId: string; states: FileState[]; expectedVersion: number; actorId: string; set: Partial<typeof batchFiles.$inferInsert> },
): Promise<boolean> {
  const rows = await tx.update(batchFiles)
    .set({ ...a.set, updatedBy: a.actorId, updatedAt: new Date(), version: sql`${batchFiles.version} + 1` })
    .where(and(eq(batchFiles.id, a.fileId), eq(batchFiles.tenantId, a.tenantId), inArray(batchFiles.state, a.states), eq(batchFiles.version, a.expectedVersion)))
    .returning({ id: batchFiles.id });
  return rows.length > 0;
}

// ── links ───────────────────────────────────────────────────────

export interface LinkInsert { id: string; tenantId: string; fileId: string; documentId: string; target: string; targetId: string; state: string; requestedBy: string; approvedBy?: string | null; financeHint?: Record<string, unknown> | null }

export async function insertLink(tx: Writer, row: LinkInsert): Promise<void> {
  await tx.insert(links).values({ ...row, approvedBy: row.approvedBy ?? null, financeHint: row.financeHint ?? null });
}

export async function getLinkTx(tx: Writer, tenantId: string, id: string, lock = false): Promise<LinkRow | null> {
  const q = tx.select().from(links).where(and(eq(links.tenantId, tenantId), eq(links.id, id))).limit(1);
  const rows = await (lock ? q.for("update") : q);
  return rows[0] ?? null;
}

export async function getLink(tenantId: string, id: string): Promise<LinkRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(links).where(and(eq(links.tenantId, tenantId), eq(links.id, id))).limit(1));
  return rows[0] ?? null;
}

export async function listLinks(
  tenantId: string, o: { state?: string | undefined; limit: number; offset: number },
): Promise<{ rows: LinkRow[]; total: number }> {
  const where = and(eq(links.tenantId, tenantId), o.state ? eq(links.state, o.state) : undefined);
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(links).where(where).orderBy(desc(links.createdAt), desc(links.id)).limit(o.limit).offset(o.offset);
    const t = await tx.select({ n: count() }).from(links).where(where);
    return { rows, total: Number(t[0]?.n ?? 0) };
  });
}

export async function linksForFile(tenantId: string, fileId: string): Promise<LinkRow[]> {
  return scopedRead((tx) => tx.select().from(links).where(and(eq(links.tenantId, tenantId), eq(links.fileId, fileId))).orderBy(desc(links.createdAt)));
}

export async function linksForFileTx(tx: Writer, tenantId: string, fileId: string): Promise<LinkRow[]> {
  return tx.select().from(links).where(and(eq(links.tenantId, tenantId), eq(links.fileId, fileId)));
}

export async function activeLinksForDocument(tenantId: string, documentId: string): Promise<LinkRow[]> {
  return scopedRead((tx) => tx.select().from(links).where(and(eq(links.tenantId, tenantId), eq(links.documentId, documentId), eq(links.state, "linked"))));
}

export async function linksByDocumentIds(tenantId: string, documentIds: string[]): Promise<LinkRow[]> {
  if (documentIds.length === 0) return [];
  return scopedRead((tx) => tx.select().from(links).where(and(eq(links.tenantId, tenantId), inArray(links.documentId, documentIds), eq(links.state, "linked"))));
}

/**
 * Race-safe link state change: `UPDATE ... WHERE state = ANY(from) [AND requested_by <> approver]`.
 * Returns the updated row, or null when someone else won / the state no longer matches.
 */
export async function moveLink(
  tx: Writer,
  a: {
    tenantId: string; linkId: string; from: string[]; to: string; actorId?: string;
    /** maker-checker: the decider must differ from the requester (also enforced by a table CHECK on approved_by). */
    notRequestedBy?: string; setApprovedBy?: string | null; reason?: string | null; resultReason?: string | null; resultDetail?: Record<string, string | number | boolean> | null;
  },
): Promise<LinkRow | null> {
  const set: Record<string, unknown> = {
    // pipeline clock: the retention sweep compares link.updatedAt against getPorts().now() for the unlink-retry delay
    state: a.to, updatedAt: getPorts().now(), version: sql`${links.version} + 1`,
  };
  if (a.setApprovedBy !== undefined) set.approvedBy = a.setApprovedBy;
  if (a.reason !== undefined) set.reason = a.reason;
  if (a.resultReason !== undefined) set.resultReason = a.resultReason;
  if (a.resultDetail !== undefined) set.resultDetail = a.resultDetail;
  const rows = await tx.update(links).set(set)
    .where(and(
      eq(links.id, a.linkId), eq(links.tenantId, a.tenantId), inArray(links.state, a.from),
      a.notRequestedBy ? ne(links.requestedBy, a.notRequestedBy) : undefined,
    )).returning();
  return rows[0] ?? null;
}

// ── search (DB fallback over the masked snippet) ────────────────

const esc = (s: string): string => s.replace(/[\\%_]/g, "\\$&");

export async function searchFiled(
  tenantId: string, o: { q: string; docType?: string | undefined; limit: number; offset: number },
): Promise<{ rows: BatchFileRow[]; total: number }> {
  const like = "%" + esc(o.q) + "%";
  const where = and(
    eq(batchFiles.tenantId, tenantId), eq(batchFiles.state, "filed"), isNull(batchFiles.retentionDeletedAt), isNotNull(batchFiles.filedDocumentId),
    o.docType ? eq(batchFiles.docType, o.docType) : undefined,
    sql`(${batchFiles.searchText} ILIKE ${like} OR ${batchFiles.originalName} ILIKE ${like})`,
  );
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(batchFiles).where(where).orderBy(desc(batchFiles.filedAt), desc(batchFiles.id)).limit(o.limit).offset(o.offset);
    const t = await tx.select({ n: count() }).from(batchFiles).where(where);
    return { rows, total: Number(t[0]?.n ?? 0) };
  });
}

// ── notification (once per completion cycle) ────────────────────

/**
 * Claim the batch-complete notification: sets notified_completed_at = completed_at only when this completion cycle
 * has not been notified yet. Returns the batch (with uploader) when THIS call claimed it, else null.
 */
export async function claimBatchNotification(tx: Writer, tenantId: string, batchId: string): Promise<{ name: string; createdBy: string; completedAt: Date } | null> {
  const rows = await tx.update(batches).set({ notifiedCompletedAt: sql`${batches.completedAt}` })
    .where(and(
      eq(batches.id, batchId), eq(batches.tenantId, tenantId), eq(batches.status, "completed"), isNotNull(batches.completedAt),
      sql`${batches.notifiedCompletedAt} IS DISTINCT FROM ${batches.completedAt}`,
    )).returning({ name: batches.name, createdBy: batches.createdBy, completedAt: batches.completedAt });
  const r = rows[0];
  return r && r.completedAt ? { name: r.name, createdBy: r.createdBy, completedAt: r.completedAt } : null;
}

export async function fileStateCounts(tx: Writer, tenantId: string, batchId: string): Promise<Record<string, number>> {
  const rows = await tx.select({ state: batchFiles.state, n: count() }).from(batchFiles)
    .where(and(eq(batchFiles.tenantId, tenantId), eq(batchFiles.batchId, batchId))).groupBy(batchFiles.state);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.state] = Number(r.n);
  return out;
}

// ── retention ───────────────────────────────────────────────────

export interface RetentionCandidate { id: string; tenantId: string; batchId: string; docType: string; filedAt: Date; filedDocumentId: string }

/** Filed, not yet purged, of `docType`, filed at or before `cutoff`. Oldest first, bounded. */
export async function retentionDue(
  tx: Pick<Writer, "select">, tenantId: string, docType: string, cutoff: Date, limit: number,
): Promise<RetentionCandidate[]> {
  const rows = await tx.select({
    id: batchFiles.id, tenantId: batchFiles.tenantId, batchId: batchFiles.batchId, docType: batchFiles.docType,
    filedAt: batchFiles.filedAt, filedDocumentId: batchFiles.filedDocumentId,
  }).from(batchFiles).where(and(
    eq(batchFiles.tenantId, tenantId), eq(batchFiles.state, "filed"), isNull(batchFiles.retentionDeletedAt),
    eq(batchFiles.docType, docType), isNotNull(batchFiles.filedAt), lte(batchFiles.filedAt, cutoff), isNotNull(batchFiles.filedDocumentId),
  )).orderBy(asc(batchFiles.filedAt)).limit(limit);
  return rows.flatMap((r) => (r.filedAt && r.filedDocumentId && r.docType ? [{ id: r.id, tenantId: r.tenantId, batchId: r.batchId, docType: r.docType, filedAt: r.filedAt, filedDocumentId: r.filedDocumentId }] : []));
}

/**
 * Tenants that currently hold filed, un-purged documents (cross-tenant discovery: scanner role only).
 * Keyset-paged by tenant id (`after`): the sweeper keeps a cursor so tenants past the page size are served on later sweeps.
 */
type DiscoveryReader = Parameters<typeof import("./repo.js").discoverDueTenants>[0];
export async function tenantsWithFiled(rdb: DiscoveryReader, limit: number, after?: string): Promise<string[]> {
  const rows = await rdb.selectDistinct({ tenantId: batchFiles.tenantId }).from(batchFiles)
    .where(and(eq(batchFiles.state, "filed"), isNull(batchFiles.retentionDeletedAt), after ? gt(batchFiles.tenantId, after) : undefined))
    .orderBy(asc(batchFiles.tenantId)).limit(limit);
  return rows.map((r) => r.tenantId);
}

/** Terminal states whose objects are deleted after `nonFiledRetentionDays` (same set that releases the canonical-hash claim). */
export const NON_FILED_PURGE_STATES = ["skipped_duplicate", "skipped", "failed", "cancelled", "quarantined"] as const;

/** Tenants with non-filed terminal files whose objects have not been purged yet (scanner role only, keyset paged). */
export async function tenantsWithNonFiled(rdb: DiscoveryReader, limit: number, after?: string): Promise<string[]> {
  const rows = await rdb.selectDistinct({ tenantId: batchFiles.tenantId }).from(batchFiles)
    .where(and(inArray(batchFiles.state, [...NON_FILED_PURGE_STATES]), isNull(batchFiles.retentionDeletedAt), after ? gt(batchFiles.tenantId, after) : undefined))
    .orderBy(asc(batchFiles.tenantId)).limit(limit);
  return rows.map((r) => r.tenantId);
}

/** Tenants with a purged file whose unlink request to a target service is not yet confirmed (scanner role only, keyset paged). */
export async function tenantsWithUnlinkPending(rdb: DiscoveryReader, limit: number, after?: string): Promise<string[]> {
  const rows = await rdb.selectDistinct({ tenantId: batchFiles.tenantId }).from(batchFiles)
    .where(and(eq(batchFiles.retentionUnlinkPending, true), after ? gt(batchFiles.tenantId, after) : undefined))
    .orderBy(asc(batchFiles.tenantId)).limit(limit);
  return rows.map((r) => r.tenantId);
}

/** Non-filed terminal files not yet purged whose last change is at or before `cutoff`. Oldest first, bounded. */
export async function nonFiledDue(tx: Pick<Writer, "select">, tenantId: string, cutoff: Date, limit: number): Promise<{ id: string; state: string }[]> {
  return tx.select({ id: batchFiles.id, state: batchFiles.state }).from(batchFiles).where(and(
    eq(batchFiles.tenantId, tenantId), inArray(batchFiles.state, [...NON_FILED_PURGE_STATES]), isNull(batchFiles.retentionDeletedAt), lte(batchFiles.updatedAt, cutoff),
  )).orderBy(asc(batchFiles.updatedAt)).limit(limit);
}

/** Purged files of the tenant still waiting for a target to confirm the unlink. */
export async function unlinkPendingFiles(tx: Pick<Writer, "select">, tenantId: string, limit: number): Promise<{ id: string; filedDocumentId: string | null }[]> {
  return tx.select({ id: batchFiles.id, filedDocumentId: batchFiles.filedDocumentId }).from(batchFiles)
    .where(and(eq(batchFiles.tenantId, tenantId), eq(batchFiles.retentionUnlinkPending, true))).orderBy(asc(batchFiles.updatedAt)).limit(limit);
}

/** Flag a purged file whose unlink requests are in flight (the sweeper re-sends them until every target confirms). */
export async function flagUnlinkPending(tx: Writer, tenantId: string, fileId: string): Promise<void> {
  await tx.update(batchFiles).set({ retentionUnlinkPending: true }).where(and(eq(batchFiles.id, fileId), eq(batchFiles.tenantId, tenantId)));
}

/** Clear the unlink-pending flag once no link of the file is waiting for (or still holding) a target. false = still pending. */
export async function clearUnlinkPendingIfDone(tx: Writer, tenantId: string, fileId: string): Promise<boolean> {
  const open = await tx.select({ id: links.id }).from(links)
    .where(and(eq(links.tenantId, tenantId), eq(links.fileId, fileId), inArray(links.state, ["unlink_requested", "linked"]))).limit(1);
  if (open.length > 0) return false;
  await tx.update(batchFiles).set({ retentionUnlinkPending: false, updatedAt: new Date() })
    .where(and(eq(batchFiles.id, fileId), eq(batchFiles.tenantId, tenantId), eq(batchFiles.retentionUnlinkPending, true)));
  return true;
}

/** Stamp a NON-filed terminal file purged (objects already deleted): conditional UPDATE, clears keys + content + the canonical-hash claim. */
export async function markNonFiledPurged(tx: Writer, a: { tenantId: string; fileId: string; actorId: string; now: Date }): Promise<{ batchId: string; state: string } | null> {
  const rows = await tx.update(batchFiles).set({
    retentionDeletedAt: a.now, textMaskedKey: null, searchablePdfKey: null, structuredJsonKey: null, finalTextKey: null, quarantineKey: null,
    searchText: null, extractedFields: null, piiFindings: null, reviewOverrides: null, pageImageCount: 0, canonicalForHash: false,
    updatedBy: a.actorId, updatedAt: a.now, version: sql`${batchFiles.version} + 1`,
  }).where(and(eq(batchFiles.id, a.fileId), eq(batchFiles.tenantId, a.tenantId), inArray(batchFiles.state, [...NON_FILED_PURGE_STATES]), isNull(batchFiles.retentionDeletedAt)))
    .returning({ batchId: batchFiles.batchId, state: batchFiles.state });
  return rows[0] ?? null;
}

/** Conditional purge stamp + derivative key / content clearing. false = already purged / not filed. */
export async function markRetentionDeleted(tx: Writer, a: { tenantId: string; fileId: string; actorId: string; now: Date }): Promise<boolean> {
  const rows = await tx.update(batchFiles).set({
    // canonical_for_hash is released too: a re-scan of the purged content must not be skipped as a duplicate of a deleted file forever
    canonicalForHash: false,
    retentionDeletedAt: a.now, textMaskedKey: null, searchablePdfKey: null, structuredJsonKey: null, finalTextKey: null,
    searchText: null, extractedFields: null, piiFindings: null, reviewOverrides: null, pageImageCount: 0,
    updatedBy: a.actorId, updatedAt: a.now, version: sql`${batchFiles.version} + 1`,
  }).where(and(eq(batchFiles.id, a.fileId), eq(batchFiles.tenantId, a.tenantId), eq(batchFiles.state, "filed"), isNull(batchFiles.retentionDeletedAt)))
    .returning({ id: batchFiles.id });
  return rows.length > 0;
}
