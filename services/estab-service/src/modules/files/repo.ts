import { eq, and, desc, asc, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  estabFiles, estabNotings, estabDispatch, estabInward, estabFileMovements, estabFileAttachments,
  estabInwardMovements,
} from "./schema.js";
import type {
  FileRow, FileInsert, NotingRow, NotingInsert, DispatchInsert, InwardInsert,
  FileMovementInsert, AttachmentRow,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
type Exec = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

/**
 * Allocate a GAPLESS CSMOP file number per (tenant, section, year). The
 * sequence is bumped atomically (INSERT … ON CONFLICT DO UPDATE … RETURNING),
 * so concurrent creations never collide or skip — unlike a random number.
 * Format: `<SECTION>/<5-digit serial>/<year>` e.g. `ESTAB-A/00007/2025`.
 */
export async function allocateFileNo(tx: Exec, tenantId: string, section: string, year: number): Promise<string> {
  const series = `file:${section}`;
  const rows = await tx.execute(sql`
    INSERT INTO files.estab_doc_seq (tenant_id, series, year, last_seq)
    VALUES (${tenantId}::uuid, ${series}, ${year}, 1)
    ON CONFLICT (tenant_id, series, year)
    DO UPDATE SET last_seq = files.estab_doc_seq.last_seq + 1
    RETURNING last_seq
  `);
  const seq = Number((rows as unknown as Array<{ last_seq: number }>)[0]?.last_seq ?? 1);
  return `${section.toUpperCase()}/${String(seq).padStart(5, "0")}/${year}`;
}

/** Allocate a gapless dispatch number per (tenant, year): `DSP/<year>/<6-digit>`. */
export async function allocateDispatchNo(tx: Exec, tenantId: string, year: number): Promise<string> {
  const rows = await tx.execute(sql`
    INSERT INTO files.estab_doc_seq (tenant_id, series, year, last_seq)
    VALUES (${tenantId}::uuid, 'dispatch', ${year}, 1)
    ON CONFLICT (tenant_id, series, year)
    DO UPDATE SET last_seq = files.estab_doc_seq.last_seq + 1
    RETURNING last_seq
  `);
  const seq = Number((rows as unknown as Array<{ last_seq: number }>)[0]?.last_seq ?? 1);
  return `DSP/${year}/${String(seq).padStart(6, "0")}`;
}

/** Record a receipt (DAK) movement for the inward register. */
export async function insertInwardMovement(tx: Writer, row: { tenantId: string; inwardId: string; fromOfficer?: string | null; toOfficer?: string | null; action: string; remarks?: string | null }): Promise<void> {
  await tx.insert(estabInwardMovements).values(row);
}

export async function listInwardMovements(inwardId: string, tenantId: string) {
  return db.select().from(estabInwardMovements)
    .where(and(eq(estabInwardMovements.tenantId, tenantId), eq(estabInwardMovements.inwardId, inwardId)))
    .orderBy(asc(estabInwardMovements.movedAt));
}

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

export type FileSearchHit = {
  id: string; fileNo: string; subject: string; dept: string;
  classification: string; status: string; rank: number; matchedIn: string;
};

/**
 * Full-text search over files (CSMOP). Matches the file's subject / file number
 * / department OR the content of any of its note-sheets, tenant-scoped, ranked
 * by relevance. Uses `websearch_to_tsquery` so users can type natural queries
 * ("pay revision" -draft "2025").
 */
export async function searchFiles(tenantId: string, q: string, limit: number): Promise<FileSearchHit[]> {
  const rows = await db.execute(sql`
    WITH query AS (SELECT websearch_to_tsquery('english', ${q}) AS tsq)
    SELECT f.id, f.file_no, f.subject, f.dept, f.classification, f.status,
           ts_rank(f.search_tsv, query.tsq) AS rank,
           CASE WHEN f.search_tsv @@ query.tsq THEN 'file' ELSE 'note_sheet' END AS matched_in
      FROM files.estab_files f, query
     WHERE f.tenant_id = ${tenantId}::uuid
       AND ( f.search_tsv @@ query.tsq
          OR EXISTS (
               SELECT 1 FROM files.estab_notings n
                WHERE n.file_id = f.id AND n.tenant_id = f.tenant_id
                  AND to_tsvector('english', coalesce(n.body, '')) @@ query.tsq) )
     ORDER BY rank DESC NULLS LAST, f.created_at DESC
     LIMIT ${limit}
  `);
  return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id), fileNo: String(r.file_no), subject: String(r.subject),
    dept: String(r.dept), classification: String(r.classification), status: String(r.status),
    rank: Number(r.rank ?? 0), matchedIn: String(r.matched_in),
  }));
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

export async function updateDispatch(tx: Writer, id: string, tenantId: string, patch: Partial<DispatchInsert>): Promise<void> {
  await tx.update(estabDispatch).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(estabDispatch.id, id), eq(estabDispatch.tenantId, tenantId)));
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
