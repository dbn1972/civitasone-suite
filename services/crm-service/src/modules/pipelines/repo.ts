import { eq, and, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { pipelines, type PipelineRow, type PipelineInsert, type PipelineView } from "./schema.js";

export function toView(r: PipelineRow): PipelineView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    stages: r.stages,
    product: r.product ?? null,
    region: r.region ?? null,
    businessUnit: r.businessUnit ?? null,
    status: r.status,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function findById(id: string, tenantId: string): Promise<PipelineView | null> {
  const rows = await scopedRead((tx) => tx.select()
    .from(pipelines)
    .where(and(eq(pipelines.id, id), eq(pipelines.tenantId, tenantId), sql`${pipelines.status} <> 'deleted'`))
    .limit(1));
  const row = rows[0];
  if (!row) return null;
  return toView(row);
}

export interface PipelineScopeFilter {
  product?: string;
  region?: string;
  businessUnit?: string;
}

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
  scope: PipelineScopeFilter = {},
): Promise<PipelineView[]> {
  const conds = [eq(pipelines.tenantId, tenantId), sql`${pipelines.status} <> 'deleted'`];
  // OP-002: filter by the scope a pipeline is differentiated on. A pipeline with a NULL
  // scope column is a tenant-wide default and matches any requested value for it.
  if (scope.product !== undefined) conds.push(sql`(${pipelines.product} = ${scope.product} OR ${pipelines.product} IS NULL)`);
  if (scope.region !== undefined) conds.push(sql`(${pipelines.region} = ${scope.region} OR ${pipelines.region} IS NULL)`);
  if (scope.businessUnit !== undefined) conds.push(sql`(${pipelines.businessUnit} = ${scope.businessUnit} OR ${pipelines.businessUnit} IS NULL)`);
  const rows = await scopedRead((tx) => tx.select()
    .from(pipelines)
    .where(and(...conds))
    .orderBy(pipelines.name)
    .limit(limit)
    .offset(offset));
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
  fields: { name?: string; stages?: PipelineRow["stages"]; product?: string | null; region?: string | null; businessUnit?: string | null },
  actorId: string,
): Promise<boolean> {
  const patch: Record<string, unknown> = {
    updatedAt: new Date(),
    updatedBy: actorId,
    version: sql`${pipelines.version} + 1`,
  };
  if (fields.name !== undefined) patch.name = fields.name;
  if (fields.stages !== undefined) patch.stages = fields.stages;
  if (fields.product !== undefined) patch.product = fields.product;
  if (fields.region !== undefined) patch.region = fields.region;
  if (fields.businessUnit !== undefined) patch.businessUnit = fields.businessUnit;

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

/**
 * Load a pipeline's stage array for stage-gate enforcement (OP-003). Returns the raw
 * stage list, or null when the pipeline is missing/deleted for this tenant.
 */
export async function stagesOf(id: string, tenantId: string): Promise<PipelineRow["stages"] | null> {
  const rows = await scopedRead((tx) => tx.select({ stages: pipelines.stages })
    .from(pipelines)
    .where(and(eq(pipelines.id, id), eq(pipelines.tenantId, tenantId), sql`${pipelines.status} <> 'deleted'`))
    .limit(1));
  return rows[0]?.stages ?? null;
}
