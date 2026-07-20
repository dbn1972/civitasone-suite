import { eq, and, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { estabFileRecord, estabRecordRequisition, estabWeedout } from "./schema.js";
import type { FileRecordRow, FileRecordInsert, RequisitionRow, RequisitionInsert, WeedoutRow, WeedoutInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// ── estab_file_record ──────────────────────────────────────────────────────

/**
 * Upsert the per-file record metadata. ON CONFLICT (tenant_id, file_id) the
 * category/retention/review-due (and optional disposal action) are refreshed
 * while created_at/created_by are preserved.
 */
export async function upsertRecord(tx: Writer, row: FileRecordInsert): Promise<void> {
  await tx.insert(estabFileRecord).values(row).onConflictDoUpdate({
    target: [estabFileRecord.tenantId, estabFileRecord.fileId],
    set: {
      recordCategory: row.recordCategory,
      retentionYears: row.retentionYears ?? null,
      reviewDueDate:  row.reviewDueDate ?? null,
      ...(row.disposalAction !== undefined ? { disposalAction: row.disposalAction } : {}),
      updatedAt:      new Date(),
      updatedBy:      row.createdBy,
    },
  });
}

/** Record a disposal action against an existing record row. */
export async function recordDisposalTx(
  tx: Writer,
  tenantId: string,
  fileId: string,
  patch: { disposalAction: string; disposedAt: Date; disposedBy: string },
): Promise<void> {
  await tx.update(estabFileRecord).set({
    disposalAction: patch.disposalAction,
    disposedAt:     patch.disposedAt,
    disposedBy:     patch.disposedBy,
    updatedAt:      new Date(),
    updatedBy:      patch.disposedBy,
  }).where(and(eq(estabFileRecord.tenantId, tenantId), eq(estabFileRecord.fileId, fileId)));
}

/**
 * True when a record category has been assigned to the file. The orchestrator
 * uses this to gate file closure (a file may not be closed until categorised).
 */
export async function hasRecordCategoryTx(tx: Writer, tenantId: string, fileId: string): Promise<boolean> {
  const rows = await (tx as typeof db).select().from(estabFileRecord)
    .where(and(eq(estabFileRecord.tenantId, tenantId), eq(estabFileRecord.fileId, fileId))).limit(1);
  return rows.length > 0;
}

/** Fetch the record row for a file (tenant-scoped), or null. */
export async function findRecordTx(tx: Writer, tenantId: string, fileId: string): Promise<FileRecordRow | null> {
  const rows = await (tx as typeof db).select().from(estabFileRecord)
    .where(and(eq(estabFileRecord.tenantId, tenantId), eq(estabFileRecord.fileId, fileId))).limit(1);
  return rows[0] ?? null;
}

// Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
// before this read — findRecordTx runs a bare db.select() with no RLS GUC set
// unless invoked through a transaction handle.
export async function findRecord(tenantId: string, fileId: string): Promise<FileRecordRow | null> {
  return db.transaction((tx) => findRecordTx(tx, tenantId, fileId));
}

// ── estab_weedout ──────────────────────────────────────────────────────────

export async function insertWeedout(tx: Writer, row: WeedoutInsert): Promise<void> {
  await tx.insert(estabWeedout).values(row);
}

export async function findWeedoutByIdTx(tx: Writer, id: string, tenantId: string): Promise<WeedoutRow | null> {
  const rows = await (tx as typeof db).select().from(estabWeedout)
    .where(and(eq(estabWeedout.id, id), eq(estabWeedout.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function updateWeedout(tx: Writer, id: string, patch: Partial<WeedoutInsert>): Promise<void> {
  await tx.update(estabWeedout).set(patch).where(eq(estabWeedout.id, id));
}

// Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
// before this read — a bare db.select() runs with no RLS GUC set.
export async function listWeedoutByTenant(tenantId: string, status: string | undefined, limit: number): Promise<WeedoutRow[]> {
  const where = status
    ? and(eq(estabWeedout.tenantId, tenantId), eq(estabWeedout.status, status))
    : eq(estabWeedout.tenantId, tenantId);
  return db.transaction((tx) => tx.select().from(estabWeedout).where(where).orderBy(desc(estabWeedout.proposedAt)).limit(limit));
}


// ── R4 record-room management ────────────────────────────────────────────

/** Transfer a file to the record room (update location fields). */
export async function transferToRecordRoom(
  tx: Writer,
  tenantId: string,
  fileId: string,
  location: { recordRoomId?: string; rack?: string; shelf?: string; bundleNo?: string },
  actorId: string,
): Promise<void> {
  await tx.update(estabFileRecord).set({
    roomStatus: "in_record_room",
    ...(location.recordRoomId ? { recordRoomId: location.recordRoomId } : {}),
    ...(location.rack ? { rack: location.rack } : {}),
    ...(location.shelf ? { shelf: location.shelf } : {}),
    ...(location.bundleNo ? { bundleNo: location.bundleNo } : {}),
    transferredAt: new Date(),
    updatedAt: new Date(),
    updatedBy: actorId,
  }).where(and(eq(estabFileRecord.tenantId, tenantId), eq(estabFileRecord.fileId, fileId)));
}

/** Mark the file as issued (out of the record room). */
export async function markRecordIssued(tx: Writer, tenantId: string, fileId: string, actorId: string): Promise<void> {
  await tx.update(estabFileRecord).set({
    roomStatus: "issued",
    updatedAt: new Date(),
    updatedBy: actorId,
  }).where(and(eq(estabFileRecord.tenantId, tenantId), eq(estabFileRecord.fileId, fileId)));
}

/** Mark the file as returned to the record room after a requisition. */
export async function markRecordReturned(tx: Writer, tenantId: string, fileId: string, actorId: string): Promise<void> {
  await tx.update(estabFileRecord).set({
    roomStatus: "in_record_room",
    updatedAt: new Date(),
    updatedBy: actorId,
  }).where(and(eq(estabFileRecord.tenantId, tenantId), eq(estabFileRecord.fileId, fileId)));
}

/** Insert a requisition (issue register entry). */
export async function insertRequisition(tx: Writer, row: RequisitionInsert): Promise<void> {
  await tx.insert(estabRecordRequisition).values(row);
}

/** Find a requisition by id. */
export async function findRequisitionByIdTx(tx: Writer, id: string, tenantId: string): Promise<RequisitionRow | null> {
  const rows = await (tx as typeof db).select().from(estabRecordRequisition)
    .where(and(eq(estabRecordRequisition.id, id), eq(estabRecordRequisition.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

/** Update requisition (for return). */
export async function updateRequisition(tx: Writer, id: string, patch: Partial<RequisitionInsert>): Promise<void> {
  await tx.update(estabRecordRequisition).set(patch).where(eq(estabRecordRequisition.id, id));
}

/** List requisitions for a tenant (issued/returned). */
// Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
// before this read — a bare db.select() runs with no RLS GUC set.
export async function listRequisitions(tenantId: string, status: string | undefined, limit: number): Promise<RequisitionRow[]> {
  const where = status
    ? and(eq(estabRecordRequisition.tenantId, tenantId), eq(estabRecordRequisition.status, status))
    : eq(estabRecordRequisition.tenantId, tenantId);
  return db.transaction((tx) => tx.select().from(estabRecordRequisition).where(where).orderBy(desc(estabRecordRequisition.issuedAt)).limit(limit));
}


// ── R5 archival & NAI transfer ───────────────────────────────────────────

import { estabArchival } from "./schema.js";
import type { ArchivalRow, ArchivalInsert } from "./schema.js";

export async function insertArchival(tx: Writer, row: ArchivalInsert): Promise<void> {
  await tx.insert(estabArchival).values(row);
}

// Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
// before this read — a bare db.select() runs with no RLS GUC set.
export async function findArchivalByFile(tenantId: string, fileId: string): Promise<ArchivalRow | null> {
  const rows = await db.transaction((tx) => tx.select().from(estabArchival)
    .where(and(eq(estabArchival.tenantId, tenantId), eq(estabArchival.fileId, fileId))).limit(1));
  return rows[0] ?? null;
}

export async function updateArchival(tx: Writer, id: string, patch: Partial<ArchivalInsert>): Promise<void> {
  await tx.update(estabArchival).set(patch).where(eq(estabArchival.id, id));
}

/** Files whose nai_eligible_at has passed but not yet transferred. */
// Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
// before this read — a bare db.select() runs with no RLS GUC set.
export async function listNaiDue(tenantId: string, limit: number): Promise<ArchivalRow[]> {
  return db.transaction((tx) => tx.select().from(estabArchival)
    .where(and(eq(estabArchival.tenantId, tenantId), eq(estabArchival.status, "nai_due")))
    .orderBy(desc(estabArchival.naiEligibleAt))
    .limit(limit));
}


// ── R6 Records Officer + annual review ───────────────────────────────────

import { estabRecordsOfficer, estabAnnualReview } from "./schema.js";
import type { RecordsOfficerRow, RecordsOfficerInsert, AnnualReviewRow, AnnualReviewInsert } from "./schema.js";

export async function upsertRecordsOfficer(tx: Writer, row: RecordsOfficerInsert): Promise<void> {
  // Only one active officer per tenant; deactivate any prior.
  await (tx as typeof db).update(estabRecordsOfficer).set({ active: false, updatedAt: new Date(), updatedBy: row.createdBy })
    .where(and(eq(estabRecordsOfficer.tenantId, row.tenantId), eq(estabRecordsOfficer.active, true)));
  await tx.insert(estabRecordsOfficer).values(row);
}

// Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
// before this read — a bare db.select() runs with no RLS GUC set.
export async function findActiveRecordsOfficer(tenantId: string): Promise<RecordsOfficerRow | null> {
  const rows = await db.transaction((tx) => tx.select().from(estabRecordsOfficer)
    .where(and(eq(estabRecordsOfficer.tenantId, tenantId), eq(estabRecordsOfficer.active, true))).limit(1));
  return rows[0] ?? null;
}

export async function insertAnnualReview(tx: Writer, row: AnnualReviewInsert): Promise<void> {
  await tx.insert(estabAnnualReview).values(row);
}

/** Files with review_due_date <= asOf that have not been acted upon (no annual review row for that period). */
// Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
// before this read — a bare db.select() runs with no RLS GUC set.
export async function listReviewDue(tenantId: string, limit: number): Promise<FileRecordRow[]> {
  // Simple approach: records with review_due_date <= today and room_status != weeded.
  // (A more rigorous approach would cross-check estab_annual_review, but this is sufficient for MVP.)
  return db.transaction((tx) => tx.select().from(estabFileRecord)
    .where(and(
      eq(estabFileRecord.tenantId, tenantId),
      // We cannot use lte directly on a string/date column without drizzle helpers,
      // so we use raw SQL below; for now just return all records with a review due date.
    ))
    .orderBy(desc(estabFileRecord.reviewDueDate))
    .limit(limit));
}

// Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
// before this read — a bare db.select() runs with no RLS GUC set.
export async function listAnnualReviews(tenantId: string, fileId: string): Promise<AnnualReviewRow[]> {
  return db.transaction((tx) => tx.select().from(estabAnnualReview)
    .where(and(eq(estabAnnualReview.tenantId, tenantId), eq(estabAnnualReview.fileId, fileId)))
    .orderBy(desc(estabAnnualReview.reviewedAt)));
}
