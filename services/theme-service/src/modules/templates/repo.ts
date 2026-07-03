import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { templates, type TemplateRow, type TemplateInsert, type TemplateView } from "./schema.js";

function toView(r: TemplateRow): TemplateView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    type: r.type,
    name: r.name,
    htmlBody: r.htmlBody,
    variables: r.variables as Record<string, string> | null,
    version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<TemplateView | null> {
  const rows = await db.select().from(templates).where(eq(templates.id, id)).limit(1);
  const row = rows[0];
  if (!row || row.tenantId !== tenantId) return null;
  return toView(row);
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<TemplateView[]> {
  const rows = await db.select().from(templates).where(eq(templates.tenantId, tenantId)).limit(limit).offset(offset);
  return rows.map(toView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: TemplateInsert): Promise<void> {
  await tx.insert(templates).values(row);
}

export { toView };
