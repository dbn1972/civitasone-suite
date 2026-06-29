import { eq, and, desc, asc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  estabFiles, estabNotings, estabDispatch, estabInward, estabFileMovements, estabFileAttachments,
} from "./schema.js";
import type {
  FileRow, FileInsert, NotingRow, NotingInsert, DispatchInsert, InwardInsert,
  FileMovementInsert, AttachmentRow,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findFileById(id: string, tenantId: string): Promise<FileRow | null> {
  const rows = await db.select().from(estabFiles)
    .where(and(eq(estabFiles.id, id), eq(estabFiles.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findInwardById(id: string, tenantId: string) {
  const rows = await db.select().from(estabInward)
    .where(and(eq(estabInward.id, id), eq(estabInward.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findNotingsByFile(fileId: string): Promise<NotingRow[]> {
  return db.select().from(estabNotings).where(eq(estabNotings.fileId, fileId)).orderBy(asc(estabNotings.seq));
}

export async function findNotingById(id: string, tenantId: string): Promise<NotingRow | null> {
  const rows = await db.select().from(estabNotings)
    .where(and(eq(estabNotings.id, id), eq(estabNotings.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function listFilesByTenant(tenantId: string, limit: number): Promise<FileRow[]> {
  return db.select().from(estabFiles).where(eq(estabFiles.tenantId, tenantId)).limit(limit);
}

export async function listInwardByTenant(tenantId: string, limit: number) {
  return db.select().from(estabInward).where(eq(estabInward.tenantId, tenantId))
    .orderBy(desc(estabInward.receivedAt)).limit(limit);
}

export async function listDispatchByTenant(tenantId: string, limit: number) {
  return db.select().from(estabDispatch).where(eq(estabDispatch.tenantId, tenantId))
    .orderBy(desc(estabDispatch.dispatchedAt)).limit(limit);
}

export async function listAttachmentsByFile(fileId: string, tenantId: string): Promise<AttachmentRow[]> {
  return db.select().from(estabFileAttachments).where(and(
    eq(estabFileAttachments.fileId, fileId),
    eq(estabFileAttachments.tenantId, tenantId),
  ));
}

export async function listDispatchByFile(fileId: string, tenantId: string) {
  return db.select().from(estabDispatch).where(and(
    eq(estabDispatch.fileId, fileId),
    eq(estabDispatch.tenantId, tenantId),
  ));
}

export async function insertFile(tx: Writer, row: FileInsert): Promise<void> {
  await tx.insert(estabFiles).values(row);
}

export async function updateFile(tx: Writer, id: string, patch: Partial<FileInsert>): Promise<void> {
  await tx.update(estabFiles).set({ ...patch, updatedAt: new Date() }).where(eq(estabFiles.id, id));
}

export async function updateInward(tx: Writer, id: string, patch: Partial<InwardInsert>): Promise<void> {
  await tx.update(estabInward).set({ ...patch, updatedAt: new Date() }).where(eq(estabInward.id, id));
}

export async function insertNoting(tx: Writer, row: NotingInsert): Promise<void> {
  await tx.insert(estabNotings).values(row);
}

export async function updateNoting(tx: Writer, id: string, patch: Partial<NotingInsert>): Promise<void> {
  await tx.update(estabNotings).set({ ...patch, updatedAt: new Date() }).where(eq(estabNotings.id, id));
}

export async function countNotings(tx: Writer, fileId: string): Promise<number> {
  const rows = await (tx as typeof db).select().from(estabNotings).where(eq(estabNotings.fileId, fileId));
  return rows.length;
}

export async function findLatestSubmittedNoting(tx: Writer, fileId: string, tenantId: string): Promise<NotingRow | null> {
  const rows = await (tx as typeof db).select().from(estabNotings).where(and(
    eq(estabNotings.fileId, fileId),
    eq(estabNotings.tenantId, tenantId),
    eq(estabNotings.noteStatus, "submitted"),
  )).orderBy(desc(estabNotings.seq)).limit(1);
  return rows[0] ?? null;
}

/** Latest noting on a file that has not yet been green-signed (for per-level auto-sign). */
export async function findLatestUnsignedNoting(tx: Writer, fileId: string, tenantId: string): Promise<NotingRow | null> {
  const rows = await (tx as typeof db).select().from(estabNotings).where(and(
    eq(estabNotings.fileId, fileId),
    eq(estabNotings.tenantId, tenantId),
    eq(estabNotings.eSigned, false),
  )).orderBy(desc(estabNotings.seq)).limit(1);
  return rows[0] ?? null;
}

export async function insertDispatch(tx: Writer, row: DispatchInsert): Promise<void> {
  await tx.insert(estabDispatch).values(row);
}

export async function insertInward(tx: Writer, row: InwardInsert): Promise<void> {
  await tx.insert(estabInward).values(row);
}

export async function insertFileMovement(tx: Writer, row: FileMovementInsert): Promise<void> {
  await tx.insert(estabFileMovements).values(row);
}

export async function insertAttachment(tx: Writer, row: typeof estabFileAttachments.$inferInsert): Promise<void> {
  await tx.insert(estabFileAttachments).values(row);
}

export async function listFileMovements(fileId: string, tenantId: string) {
  return db.select().from(estabFileMovements).where(and(
    eq(estabFileMovements.fileId, fileId),
    eq(estabFileMovements.tenantId, tenantId),
  )).orderBy(desc(estabFileMovements.movedAt));
}
