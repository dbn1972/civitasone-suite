import { eq, and, sql, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { customFields, type CustomFieldRow, type CustomFieldInsert, type CustomFieldView } from "./schema.js";

export function toView(r: CustomFieldRow): CustomFieldView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    entityType: r.entityType,
    fieldName: r.fieldName,
    fieldType: r.fieldType,
    validationSchema: r.validationSchema,
    ordinal: r.ordinal,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function findById(id: string, tenantId: string): Promise<CustomFieldView | null> {
  const rows = await db.select().from(customFields)
    .where(and(eq(customFields.id, id), eq(customFields.tenantId, tenantId)))
    .limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

export async function listByEntityType(
  tenantId: string,
  entityType: string,
  limit: number,
  offset: number,
): Promise<CustomFieldView[]> {
  const rows = await db.select().from(customFields)
    .where(and(eq(customFields.tenantId, tenantId), eq(customFields.entityType, entityType)))
    .orderBy(customFields.ordinal)
    .limit(limit)
    .offset(offset);
  return rows.map(toView);
}

export async function countByEntityType(tenantId: string, entityType: string): Promise<number> {
  const result = await db.select({ count: sql<number>`count(*)::int` })
    .from(customFields)
    .where(and(eq(customFields.tenantId, tenantId), eq(customFields.entityType, entityType)));
  return result[0]?.count ?? 0;
}

export type Writer = Pick<typeof db, "insert" | "update" | "delete" | "select">;

export async function insert(tx: Writer, row: CustomFieldInsert): Promise<void> {
  await tx.insert(customFields).values(row);
}

export async function update(
  tx: Writer,
  id: string,
  tenantId: string,
  fields: { fieldName?: string | undefined; fieldType?: string | undefined; validationSchema?: unknown; ordinal?: number | undefined },
  actorId: string,
): Promise<void> {
  const patch: Record<string, unknown> = {
    updatedAt: new Date(),
    updatedBy: actorId,
    version: sql`${customFields.version} + 1`,
  };
  if (fields.fieldName !== undefined) patch.fieldName = fields.fieldName;
  if (fields.fieldType !== undefined) patch.fieldType = fields.fieldType;
  if (fields.validationSchema !== undefined) patch.validationSchema = fields.validationSchema;
  if (fields.ordinal !== undefined) patch.ordinal = fields.ordinal;
  await (tx as typeof db).update(customFields)
    .set(patch)
    .where(and(eq(customFields.id, id), eq(customFields.tenantId, tenantId)));
}

export async function remove(tx: Writer, id: string, tenantId: string): Promise<void> {
  await (tx as typeof db).delete(customFields)
    .where(and(eq(customFields.id, id), eq(customFields.tenantId, tenantId)));
}
