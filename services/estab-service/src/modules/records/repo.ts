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

export async function findRecord(tenantId: string, fileId: string): Promise<FileRecordRow | null> {
  return findRecordTx(db, tenantId, fileId);
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

export async function listWeedoutByTenant(tenantId: string, status: string | undefined, limit: number): Promise<WeedoutRow[]> {
  const where = status
    ? and(eq(estabWeedout.tenantId, tenantId), eq(estabWeedout.status, status))
    : eq(estabWeedout.tenantId, tenantId);
  return db.select().from(estabWeedout).where(where).orderBy(desc(estabWeedout.proposedAt)).limit(limit);
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
export async function listRequisitions(tenantId: string, status: string | undefined, limit: number): Promise<RequisitionRow[]> {
  const where = status
    ? and(eq(estabRecordRequisition.tenantId, tenantId), eq(estabRecordRequisition.status, status))
    : eq(estabRecordRequisition.tenantId, tenantId);
  return db.select().from(estabRecordRequisition).where(where).orderBy(desc(estabRecordRequisition.issuedAt)).limit(limit);
}
