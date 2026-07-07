import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { pipelines, type PipelineRow, type PipelineInsert, type PipelineView } from "./schema.js";

export function toView(r: PipelineRow): PipelineView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    stages: r.stages,
    status: r.status,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function findById(id: string, tenantId: string): Promise<PipelineView | null> {
  const rows = await db.select()
    .from(pipelines)
    .where(and(eq(pipelines.id, id), eq(pipelines.tenantId, tenantId), sql`${pipelines.status} <> 'deleted'`))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return toView(row);
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<PipelineView[]> {
  const rows = await db.select()
    .from(pipelines)
    .where(and(eq(pipelines.tenantId, tenantId), sql`${pipelines.status} <> 'deleted'`))
    .orderBy(pipelines.name)
    .limit(limit)
    .offset(offset);
  return rows.map(toView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: PipelineInsert): Promise<void> {
  await tx.insert(pipelines).values(row);
}

/**
 * Update pipeline with optimistic locking.
 * Returns true if update matched (version was current), false on conflict.
 */
export async function updateWithVersion(
  tx: Writer,
  id: string,
  tenantId: string,
  expectedVersion: number,
  fields: { name?: string; stages?: PipelineRow["stages"] },
  actorId: string,
): Promise<boolean> {
  const patch: Record<string, unknown> = {
    updatedAt: new Date(),
    updatedBy: actorId,
    version: sql`${pipelines.version} + 1`,
  };
  if (fields.name !== undefined) patch.name = fields.name;
  if (fields.stages !== undefined) patch.stages = fields.stages;

  const result = await (tx as typeof db).update(pipelines)
    .set(patch)
    .where(and(
      eq(pipelines.id, id),
      eq(pipelines.tenantId, tenantId),
      eq(pipelines.version, expectedVersion),
      sql`${pipelines.status} <> 'deleted'`,
    ))
    .returning({ id: pipelines.id });

  return result.length > 0;
}

export async function softDelete(tx: Writer, id: string, tenantId: string, actorId: string): Promise<void> {
  await (tx as typeof db).update(pipelines)
    .set({ status: "deleted", updatedAt: new Date(), updatedBy: actorId, version: sql`${pipelines.version} + 1` })
    .where(and(eq(pipelines.id, id), eq(pipelines.tenantId, tenantId)));
}
