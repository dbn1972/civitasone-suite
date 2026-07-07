/**
 * templates repo — Drizzle queries against reports.report_templates.
 */
import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { reportTemplates, type TemplateRow, type TemplateInsert, type TemplateView } from "./schema.js";
import type { TemplateFilter, TemplateGroup, TemplateAggregation, TemplateParameter } from "./schema.js";

function toView(r: TemplateRow): TemplateView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    description: r.description,
    dataSourceId: r.dataSourceId,
    filters: (r.filters ?? []) as TemplateFilter[],
    groups: (r.groups ?? []) as TemplateGroup[],
    aggregations: (r.aggregations ?? []) as TemplateAggregation[],
    parameters: (r.parameters ?? []) as TemplateParameter[],
    outputFormat: r.outputFormat,
    status: r.status,
    version: r.version,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    createdBy: r.createdBy,
    updatedBy: r.updatedBy,
  };
}

export async function findById(id: string, tenantId: string): Promise<TemplateView | null> {
  const rows = await db.select().from(reportTemplates)
    .where(and(eq(reportTemplates.id, id), eq(reportTemplates.tenantId, tenantId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return toView(row);
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<TemplateView[]> {
  const rows = await db.select().from(reportTemplates)
    .where(and(
      eq(reportTemplates.tenantId, tenantId),
      sql`${reportTemplates.status} != 'archived'`,
    ))
    .limit(limit)
    .offset(offset);
  return rows.map(toView);
}

export async function countByTenant(tenantId: string): Promise<number> {
  const result = await db.select({ count: sql<number>`count(*)::int` })
    .from(reportTemplates)
    .where(and(
      eq(reportTemplates.tenantId, tenantId),
      sql`${reportTemplates.status} != 'archived'`,
    ));
  return result[0]?.count ?? 0;
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: TemplateInsert): Promise<void> {
  await tx.insert(reportTemplates).values(row);
}

export async function update(
  tx: Writer,
  id: string,
  tenantId: string,
  currentVersion: number,
  data: Partial<Omit<TemplateInsert, "id" | "tenantId" | "createdAt" | "createdBy">>,
): Promise<boolean> {
  const result = await tx.update(reportTemplates)
    .set({ ...data, version: currentVersion + 1, updatedAt: new Date() })
    .where(and(
      eq(reportTemplates.id, id),
      eq(reportTemplates.tenantId, tenantId),
      eq(reportTemplates.version, currentVersion),
    ));
  // Drizzle update returns an array for pg-js driver
  return (result as unknown as { rowCount: number }).rowCount > 0;
}

export async function softDelete(tx: Writer, id: string, tenantId: string, actorId: string): Promise<boolean> {
  const result = await tx.update(reportTemplates)
    .set({ status: "archived", updatedAt: new Date(), updatedBy: actorId })
    .where(and(
      eq(reportTemplates.id, id),
      eq(reportTemplates.tenantId, tenantId),
      sql`${reportTemplates.status} != 'archived'`,
    ));
  return (result as unknown as { rowCount: number }).rowCount > 0;
}

export { toView };
