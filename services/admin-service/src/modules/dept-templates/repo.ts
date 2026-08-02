/**
 * ORG-07 — DB access for department templates and their instantiations.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  departmentTemplates,
  departmentInstantiations,
  type DepartmentTemplateRow,
  type DepartmentTemplateInsert,
  type DepartmentInstantiationRow,
  type DepartmentInstantiationInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
// Drizzle's insert/update builders expose `.returning()` and
// `.returning({ col })`; this narrow structural type covers both without
// pulling the full builder generics into every repo signature.
type Returning<T> = { returning: (fields?: Record<string, unknown>) => Promise<T[]> };

export async function insertTemplate(tx: Writer, row: DepartmentTemplateInsert): Promise<DepartmentTemplateRow> {
  const rows = await (tx.insert(departmentTemplates).values(row) as unknown as Returning<DepartmentTemplateRow>).returning();
  const created = rows[0];
  if (!created) throw new Error("insertTemplate: no row returned");
  return created;
}

export async function findTemplateTx(tx: Writer, tenantId: string, id: string): Promise<DepartmentTemplateRow | undefined> {
  const rows = await tx.select().from(departmentTemplates)
    .where(and(eq(departmentTemplates.id, id), eq(departmentTemplates.tenantId, tenantId))).limit(1);
  return rows[0];
}

export async function findTemplate(tenantId: string, id: string): Promise<DepartmentTemplateRow | undefined> {
  return scopedRead((tx) => findTemplateTx(tx as Writer, tenantId, id));
}

export async function findTemplateByCodeTx(tx: Writer, tenantId: string, code: string): Promise<DepartmentTemplateRow | undefined> {
  const rows = await tx.select().from(departmentTemplates)
    .where(and(eq(departmentTemplates.code, code), eq(departmentTemplates.tenantId, tenantId))).limit(1);
  return rows[0];
}

export async function listTemplates(
  tenantId: string, limit: number, offset: number, status?: string,
): Promise<{ rows: DepartmentTemplateRow[]; total: number }> {
  const clauses = [eq(departmentTemplates.tenantId, tenantId)];
  if (status !== undefined) clauses.push(eq(departmentTemplates.status, status));
  const where = and(...clauses);
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(departmentTemplates).where(where)
      .orderBy(departmentTemplates.code).limit(limit).offset(offset);
    const counted = await tx.select({ n: sql<number>`count(*)::int` }).from(departmentTemplates).where(where);
    return { rows, total: counted[0]?.n ?? 0 };
  });
}

/** Optimistic-locked template update. False → 409. */
export async function updateTemplate(
  tx: Writer,
  tenantId: string,
  id: string,
  expectedVersion: number,
  patch: Partial<DepartmentTemplateInsert>,
): Promise<boolean> {
  const rows = await (tx.update(departmentTemplates)
    .set({ ...patch, updatedAt: new Date(), version: expectedVersion + 1 })
    .where(and(
      eq(departmentTemplates.id, id),
      eq(departmentTemplates.tenantId, tenantId),
      eq(departmentTemplates.version, expectedVersion),
    )) as unknown as Returning<{ id: string }>).returning({ id: departmentTemplates.id });
  return rows.length > 0;
}

// ── instantiations ──────────────────────────────────────────────────────────

export async function findInstantiationByKeyTx(
  tx: Writer, tenantId: string, templateId: string, idempotencyKey: string,
): Promise<DepartmentInstantiationRow | undefined> {
  const rows = await tx.select().from(departmentInstantiations)
    .where(and(
      eq(departmentInstantiations.tenantId, tenantId),
      eq(departmentInstantiations.templateId, templateId),
      eq(departmentInstantiations.idempotencyKey, idempotencyKey),
    )).limit(1);
  return rows[0];
}

export async function findInstantiationByCodeTx(
  tx: Writer, tenantId: string, departmentCode: string,
): Promise<DepartmentInstantiationRow | undefined> {
  const rows = await tx.select().from(departmentInstantiations)
    .where(and(
      eq(departmentInstantiations.tenantId, tenantId),
      eq(departmentInstantiations.departmentCode, departmentCode),
    )).limit(1);
  return rows[0];
}

export async function insertInstantiation(
  tx: Writer, row: DepartmentInstantiationInsert,
): Promise<DepartmentInstantiationRow> {
  const rows = await (tx.insert(departmentInstantiations).values(row) as unknown as Returning<DepartmentInstantiationRow>).returning();
  const created = rows[0];
  if (!created) throw new Error("insertInstantiation: no row returned");
  return created;
}

export async function listInstantiations(
  tenantId: string, templateId: string, limit: number, offset: number,
): Promise<{ rows: DepartmentInstantiationRow[]; total: number }> {
  const where = and(
    eq(departmentInstantiations.tenantId, tenantId),
    eq(departmentInstantiations.templateId, templateId),
  );
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(departmentInstantiations).where(where)
      .orderBy(desc(departmentInstantiations.createdAt)).limit(limit).offset(offset);
    const counted = await tx.select({ n: sql<number>`count(*)::int` }).from(departmentInstantiations).where(where);
    return { rows, total: counted[0]?.n ?? 0 };
  });
}
