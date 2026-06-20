import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { estabFiles, estabNotings, estabDispatch, estabInward } from "./schema.js";
import type { FileRow, FileInsert, NotingRow, NotingInsert, DispatchInsert, InwardInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findFileById(id: string, tenantId: string): Promise<FileRow | null> {
  const rows = await db.select().from(estabFiles)
    .where(and(eq(estabFiles.id, id), eq(estabFiles.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findNotingsByFile(fileId: string): Promise<NotingRow[]> {
  return db.select().from(estabNotings).where(eq(estabNotings.fileId, fileId));
}

export async function listFilesByTenant(tenantId: string, limit: number): Promise<FileRow[]> {
  return db.select().from(estabFiles).where(eq(estabFiles.tenantId, tenantId)).limit(limit);
}

export async function insertFile(tx: Writer, row: FileInsert): Promise<void> {
  await tx.insert(estabFiles).values(row);
}

export async function updateFile(tx: Writer, id: string, patch: Partial<FileInsert>): Promise<void> {
  await tx.update(estabFiles).set({ ...patch, updatedAt: new Date() }).where(eq(estabFiles.id, id));
}

export async function insertNoting(tx: Writer, row: NotingInsert): Promise<void> {
  await tx.insert(estabNotings).values(row);
}

export async function countNotings(tx: Writer, fileId: string): Promise<number> {
  const rows = await (tx as typeof db).select().from(estabNotings).where(eq(estabNotings.fileId, fileId));
  return rows.length;
}

export async function insertDispatch(tx: Writer, row: DispatchInsert): Promise<void> {
  await tx.insert(estabDispatch).values(row);
}

export async function insertInward(tx: Writer, row: InwardInsert): Promise<void> {
  await tx.insert(estabInward).values(row);
}
