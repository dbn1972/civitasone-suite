import { and, eq, asc, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { estabCorrespondence, estabFilePuc } from "./schema.js";
import type {
  CorrespondenceRow, CorrespondenceInsert, FilePucRow, FilePucInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select" | "execute">;

// ── Correspondence reads (tenant-scoped) ──────────────────────────────────

// Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
// before this read — a bare db.select() runs with no RLS GUC set.
export async function listCorrespondenceByFile(
  fileId: string,
  tenantId: string,
): Promise<CorrespondenceRow[]> {
  return db.transaction((tx) => tx.select().from(estabCorrespondence).where(and(
    eq(estabCorrespondence.fileId, fileId),
    eq(estabCorrespondence.tenantId, tenantId),
  )).orderBy(asc(estabCorrespondence.pageFrom)));
}

// Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
// before this read — a bare db.select() runs with no RLS GUC set.
export async function findCorrespondenceById(
  id: string,
  tenantId: string,
): Promise<CorrespondenceRow | null> {
  const rows = await db.transaction((tx) => tx.select().from(estabCorrespondence).where(and(
    eq(estabCorrespondence.id, id),
    eq(estabCorrespondence.tenantId, tenantId),
  )).limit(1));
  return rows[0] ?? null;
}

// ── PUC reads (tenant-scoped) ─────────────────────────────────────────────

// Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
// before this read — a bare db.select() runs with no RLS GUC set.
export async function listActivePucByFile(
  fileId: string,
  tenantId: string,
): Promise<FilePucRow[]> {
  return db.transaction((tx) => tx.select().from(estabFilePuc).where(and(
    eq(estabFilePuc.fileId, fileId),
    eq(estabFilePuc.tenantId, tenantId),
    eq(estabFilePuc.active, true),
  )).orderBy(asc(estabFilePuc.markedAt)));
}

// ── Writes (inside the consumer's transaction) ────────────────────────────

/**
 * Current highest page_to on a file (0 if none). Read inside the same tx as the
 * subsequent insert so the running page sequence is assigned atomically.
 */
export async function maxPageTo(tx: Writer, fileId: string, tenantId: string): Promise<number> {
  const rows = await (tx as typeof db).execute(sql`
    SELECT COALESCE(MAX(page_to), 0)::int AS max_page
    FROM files.estab_correspondence
    WHERE tenant_id = ${tenantId} AND file_id = ${fileId}
  `);
  const r = (rows as unknown as Array<{ max_page: number }>)[0];
  return r?.max_page ?? 0;
}

/** Count of correspondence already on a file (for the running corr_no). */
export async function countCorrespondence(tx: Writer, fileId: string, tenantId: string): Promise<number> {
  const rows = await (tx as typeof db).select().from(estabCorrespondence).where(and(
    eq(estabCorrespondence.fileId, fileId),
    eq(estabCorrespondence.tenantId, tenantId),
  ));
  return rows.length;
}

export async function insertCorrespondence(tx: Writer, row: CorrespondenceInsert): Promise<void> {
  await tx.insert(estabCorrespondence).values(row);
}

export async function insertPuc(tx: Writer, row: FilePucInsert): Promise<void> {
  await tx.insert(estabFilePuc).values(row);
}

export async function deactivatePuc(
  tx: Writer,
  fileId: string,
  tenantId: string,
  correspondenceId: string,
): Promise<void> {
  await tx.update(estabFilePuc)
    .set({ active: false })
    .where(and(
      eq(estabFilePuc.fileId, fileId),
      eq(estabFilePuc.tenantId, tenantId),
      eq(estabFilePuc.correspondenceId, correspondenceId),
      eq(estabFilePuc.active, true),
    ));
}
