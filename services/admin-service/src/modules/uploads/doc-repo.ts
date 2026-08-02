/**
 * DM-002 — DB access for document types, requirements and documents.
 */
import { and, asc, desc, eq, inArray, isNotNull, lte, ne, sql, type SQL } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  documentTypes,
  documentRequirements,
  documents,
  type DocumentTypeRow,
  type DocumentTypeInsert,
  type DocumentRequirementRow,
  type DocumentRequirementInsert,
  type DocumentRow,
  type DocumentInsert,
} from "./doc-schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
// Drizzle's insert/update builders expose `.returning()` and
// `.returning({ col })`; this narrow structural type covers both without
// pulling the full builder generics into every repo signature.
type Returning<T> = { returning: (fields?: Record<string, unknown>) => Promise<T[]> };

// ── document types ──────────────────────────────────────────────────────────

export async function insertType(tx: Writer, row: DocumentTypeInsert): Promise<DocumentTypeRow> {
  const rows = await (tx.insert(documentTypes).values(row) as unknown as Returning<DocumentTypeRow>).returning();
  const created = rows[0];
  if (!created) throw new Error("insertType: no row returned");
  return created;
}

export async function findTypeByCodeTx(tx: Writer, tenantId: string, code: string): Promise<DocumentTypeRow | undefined> {
  const rows = await tx.select().from(documentTypes)
    .where(and(eq(documentTypes.tenantId, tenantId), eq(documentTypes.code, code))).limit(1);
  return rows[0];
}

export async function findTypeTx(tx: Writer, tenantId: string, id: string): Promise<DocumentTypeRow | undefined> {
  const rows = await tx.select().from(documentTypes)
    .where(and(eq(documentTypes.tenantId, tenantId), eq(documentTypes.id, id))).limit(1);
  return rows[0];
}

export async function listTypes(
  tenantId: string, limit: number, offset: number, status?: string,
): Promise<{ rows: DocumentTypeRow[]; total: number }> {
  const clauses = [eq(documentTypes.tenantId, tenantId)];
  if (status !== undefined) clauses.push(eq(documentTypes.status, status));
  const where = and(...clauses);
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(documentTypes).where(where)
      .orderBy(asc(documentTypes.code)).limit(limit).offset(offset);
    const counted = await tx.select({ n: sql<number>`count(*)::int` }).from(documentTypes).where(where);
    return { rows, total: counted[0]?.n ?? 0 };
  });
}

export async function typesByCodes(tenantId: string, codes: readonly string[]): Promise<DocumentTypeRow[]> {
  if (codes.length === 0) return [];
  return scopedRead((tx) => tx.select().from(documentTypes)
    .where(and(eq(documentTypes.tenantId, tenantId), inArray(documentTypes.code, [...codes]))));
}

/** Optimistic-locked type update. False → 409. */
export async function updateType(
  tx: Writer, tenantId: string, id: string, expectedVersion: number, patch: Partial<DocumentTypeInsert>,
): Promise<boolean> {
  const rows = await (tx.update(documentTypes)
    .set({ ...patch, updatedAt: new Date(), version: expectedVersion + 1 })
    .where(and(
      eq(documentTypes.id, id),
      eq(documentTypes.tenantId, tenantId),
      eq(documentTypes.version, expectedVersion),
    )) as unknown as Returning<{ id: string }>).returning({ id: documentTypes.id });
  return rows.length > 0;
}

// ── requirements ────────────────────────────────────────────────────────────

export async function upsertRequirement(tx: Writer, row: DocumentRequirementInsert): Promise<DocumentRequirementRow> {
  const rows = await (tx.insert(documentRequirements).values(row)
    .onConflictDoUpdate({
      target: [
        documentRequirements.tenantId, documentRequirements.contextType,
        documentRequirements.contextKey, documentRequirements.documentTypeCode,
      ],
      set: {
        mandatory: row.mandatory ?? true,
        updatedBy: row.updatedBy,
        updatedAt: new Date(),
        version: sql`${documentRequirements.version} + 1`,
      },
    }) as unknown as Returning<DocumentRequirementRow>).returning();
  const saved = rows[0];
  if (!saved) throw new Error("upsertRequirement: no row returned");
  return saved;
}

function requirementWhere(tenantId: string, contextType?: string, contextKey?: string): SQL | undefined {
  const clauses: SQL[] = [eq(documentRequirements.tenantId, tenantId)];
  if (contextType !== undefined) clauses.push(eq(documentRequirements.contextType, contextType));
  if (contextKey !== undefined) clauses.push(eq(documentRequirements.contextKey, contextKey));
  return and(...clauses);
}

export async function listRequirements(
  tenantId: string, limit: number, offset: number, contextType?: string, contextKey?: string,
): Promise<{ rows: DocumentRequirementRow[]; total: number }> {
  const where = requirementWhere(tenantId, contextType, contextKey);
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(documentRequirements).where(where)
      .orderBy(asc(documentRequirements.documentTypeCode)).limit(limit).offset(offset);
    const counted = await tx.select({ n: sql<number>`count(*)::int` }).from(documentRequirements).where(where);
    return { rows, total: counted[0]?.n ?? 0 };
  });
}

export async function requirementsForContext(
  tenantId: string, contextType: string, contextKey: string, limit: number,
): Promise<DocumentRequirementRow[]> {
  return scopedRead((tx) => tx.select().from(documentRequirements)
    .where(requirementWhere(tenantId, contextType, contextKey))
    .orderBy(asc(documentRequirements.documentTypeCode)).limit(limit));
}

// ── documents ───────────────────────────────────────────────────────────────

export async function insertDocument(tx: Writer, row: DocumentInsert): Promise<DocumentRow> {
  const rows = await (tx.insert(documents).values(row) as unknown as Returning<DocumentRow>).returning();
  const created = rows[0];
  if (!created) throw new Error("insertDocument: no row returned");
  return created;
}

export async function findDocumentTx(tx: Writer, tenantId: string, id: string): Promise<DocumentRow | undefined> {
  const rows = await tx.select().from(documents)
    .where(and(eq(documents.tenantId, tenantId), eq(documents.id, id))).limit(1);
  return rows[0];
}

export async function findDocument(tenantId: string, id: string): Promise<DocumentRow | undefined> {
  return scopedRead((tx) => findDocumentTx(tx as Writer, tenantId, id));
}

function documentWhere(
  tenantId: string, contextType?: string, contextKey?: string, subjectId?: string, status?: string,
): SQL | undefined {
  const clauses: SQL[] = [eq(documents.tenantId, tenantId)];
  if (contextType !== undefined) clauses.push(eq(documents.contextType, contextType));
  if (contextKey !== undefined) clauses.push(eq(documents.contextKey, contextKey));
  if (subjectId !== undefined) clauses.push(eq(documents.subjectId, subjectId));
  if (status !== undefined) clauses.push(eq(documents.status, status));
  return and(...clauses);
}

export async function listDocuments(
  tenantId: string, limit: number, offset: number,
  filter: { contextType?: string | undefined; contextKey?: string | undefined; subjectId?: string | undefined; status?: string | undefined },
): Promise<{ rows: DocumentRow[]; total: number }> {
  const where = documentWhere(tenantId, filter.contextType, filter.contextKey, filter.subjectId, filter.status);
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(documents).where(where)
      .orderBy(desc(documents.createdAt)).limit(limit).offset(offset);
    const counted = await tx.select({ n: sql<number>`count(*)::int` }).from(documents).where(where);
    return { rows, total: counted[0]?.n ?? 0 };
  });
}

export async function documentsForContext(
  tenantId: string, contextType: string, contextKey: string, subjectId: string | undefined, limit: number,
): Promise<DocumentRow[]> {
  return scopedRead((tx) => tx.select().from(documents)
    .where(documentWhere(tenantId, contextType, contextKey, subjectId))
    .orderBy(desc(documents.createdAt)).limit(limit));
}

/**
 * Candidates for the expiry scan: documents that HAVE an expiry, are not already
 * terminal, and expire on or before `horizon` (now + the widest warning window).
 */
export async function expiryCandidatesTx(
  tx: Writer, tenantId: string, horizon: Date, limit: number,
): Promise<DocumentRow[]> {
  return tx.select().from(documents)
    .where(and(
      eq(documents.tenantId, tenantId),
      isNotNull(documents.expiresAt),
      ne(documents.status, "superseded"),
      lte(documents.expiresAt, horizon),
    ))
    .orderBy(asc(documents.expiresAt))
    .limit(limit);
}

/** Optimistic-locked document update. False → 409 / skip. */
export async function updateDocument(
  tx: Writer, tenantId: string, id: string, expectedVersion: number, patch: Partial<DocumentInsert>,
): Promise<boolean> {
  const rows = await (tx.update(documents)
    .set({ ...patch, updatedAt: new Date(), version: expectedVersion + 1 })
    .where(and(
      eq(documents.id, id),
      eq(documents.tenantId, tenantId),
      eq(documents.version, expectedVersion),
    )) as unknown as Returning<{ id: string }>).returning({ id: documents.id });
  return rows.length > 0;
}
