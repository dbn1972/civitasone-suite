import { and, desc, eq, ilike, or, notInArray, sql, type SQL } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { estabFiles } from "../files/schema.js";
import { fileScannedDocuments, type ScannedDocumentRow, type ScannedDocumentInsert } from "./schema.js";
import { LOOKUP_EXCLUDED_CLASSIFICATIONS, escapeLike, normaliseFileNo, tokenise, type LookupFileRow } from "./domain.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select" | "execute">;

// ── reads (route side). db.transaction() makes wrapWithTenantGuc set app.tenant_id. ──

export async function listByFile(
  fileId: string, tenantId: string, state: "linked" | "unlinked" | "all", limit: number,
): Promise<ScannedDocumentRow[]> {
  const conds = [eq(fileScannedDocuments.fileId, fileId), eq(fileScannedDocuments.tenantId, tenantId)];
  if (state !== "all") conds.push(eq(fileScannedDocuments.state, state));
  return db.transaction((tx) =>
    tx.select().from(fileScannedDocuments).where(and(...conds))
      .orderBy(desc(fileScannedDocuments.filedAt), desc(fileScannedDocuments.id)).limit(limit));
}

/** Pre-filter candidates for lookup; exact scoring/ranking is done by domain.rankCandidates. */
export async function lookupCandidates(
  tenantId: string, q: { fileNo?: string | undefined; subject?: string | undefined },
): Promise<LookupFileRow[]> {
  const ors: SQL[] = [];
  if (q.fileNo) {
    const wantNo = normaliseFileNo(q.fileNo);
    ors.push(sql`lower(replace(${estabFiles.fileNo}, ' ', '')) = ${wantNo}`);
    if (wantNo.length >= 4) {
      ors.push(ilike(estabFiles.fileNo, `%${escapeLike(q.fileNo.trim())}%`));
    }
  }
  if (q.subject) {
    for (const t of tokenise(q.subject).slice(0, 8)) ors.push(ilike(estabFiles.subject, `%${escapeLike(t)}%`));
  }
  if (ors.length === 0) return [];
  const rows = await db.transaction((tx) =>
    tx.select({ id: estabFiles.id, fileNo: estabFiles.fileNo, subject: estabFiles.subject, status: estabFiles.status })
      .from(estabFiles)
      .where(and(
        eq(estabFiles.tenantId, tenantId),
        notInArray(estabFiles.classification, [...LOOKUP_EXCLUDED_CLASSIFICATIONS]),
        or(...ors),
      ))
      .orderBy(desc(estabFiles.updatedAt)).limit(200));
  return rows;
}

/** Lightweight tenant-scoped file header for the read route (existence + classification gate). */
export async function findFileHeader(
  fileId: string, tenantId: string,
): Promise<{ id: string; classification: string } | null> {
  const rows = await db.transaction((tx) =>
    tx.select({ id: estabFiles.id, classification: estabFiles.classification }).from(estabFiles)
      .where(and(eq(estabFiles.id, fileId), eq(estabFiles.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

// ── consumer side (always through the caller's tx) ──

export async function findFileTx(
  tx: Writer, fileId: string, tenantId: string,
): Promise<{ id: string; fileNo: string; status: string; classification: string } | null> {
  const rows = await tx.select({ id: estabFiles.id, fileNo: estabFiles.fileNo, status: estabFiles.status, classification: estabFiles.classification })
    .from(estabFiles).where(and(eq(estabFiles.id, fileId), eq(estabFiles.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findByLinkIdTx(tx: Writer, linkId: string, tenantId: string): Promise<ScannedDocumentRow | null> {
  const rows = await tx.select().from(fileScannedDocuments)
    .where(and(eq(fileScannedDocuments.linkId, linkId), eq(fileScannedDocuments.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findActiveForDocumentTx(
  tx: Writer, fileId: string, documentId: string, tenantId: string,
): Promise<ScannedDocumentRow | null> {
  const rows = await tx.select().from(fileScannedDocuments).where(and(
    eq(fileScannedDocuments.fileId, fileId), eq(fileScannedDocuments.documentId, documentId),
    eq(fileScannedDocuments.tenantId, tenantId), eq(fileScannedDocuments.state, "linked"),
  )).limit(1);
  return rows[0] ?? null;
}

/** Returns true when a row was inserted (false = (tenant_id, link_id) already existed). */
export async function insertLinkTx(tx: Writer, row: ScannedDocumentInsert): Promise<boolean> {
  const out = await tx.insert(fileScannedDocuments).values(row)
    .onConflictDoNothing({ target: [fileScannedDocuments.tenantId, fileScannedDocuments.linkId] })
    .returning({ id: fileScannedDocuments.id });
  return out.length > 0;
}

/** Race-safe conditional unlink: only a currently-linked row flips. Returns true when it flipped. */
export async function markUnlinkedTx(
  tx: Writer, o: { linkId: string; tenantId: string; reason: string; actorId: string },
): Promise<boolean> {
  const out = await tx.update(fileScannedDocuments).set({
    state: "unlinked", unlinkReason: o.reason, unlinkedBy: o.actorId, unlinkedAt: new Date(),
    updatedAt: new Date(), updatedBy: o.actorId, version: sql`${fileScannedDocuments.version} + 1`,
  }).where(and(
    eq(fileScannedDocuments.linkId, o.linkId), eq(fileScannedDocuments.tenantId, o.tenantId),
    eq(fileScannedDocuments.state, "linked"),
  )).returning({ id: fileScannedDocuments.id });
  return out.length > 0;
}
