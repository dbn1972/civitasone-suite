import { eq, desc, and, sql } from "drizzle-orm";
import { db, scopedRead, scopedExecute } from "../../shared/db.js";
import { instances, type InstanceRow, type InstanceInsert, type InstanceView } from "./schema.js";

export function toView(r: InstanceRow): InstanceView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    status: r.status,
    definitionId: r.definitionId,
    refType: r.refType,
    refId: r.refId,
    currentNode: r.currentNode,
    version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<InstanceView | null> {
  const rows = await scopedRead((tx) => tx.select().from(instances).where(eq(instances.id, id)).limit(1));
  const row = rows[0];
  if (!row || row.tenantId !== tenantId) return null;
  return toView(row);
}

export async function findByIdTx(tx: Writer, id: string): Promise<InstanceRow | null> {
  const rows = await (tx as typeof db).select().from(instances).where(eq(instances.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * H1 — serialize per-instance branch closes. Acquire a FOR UPDATE row lock on
 * the instance so concurrent sibling-branch completions cannot both read the
 * open-task count at the same time (which would either double-advance a join or
 * leave the instance stuck). Every completion transaction locks this row before
 * counting open tasks / advancing, forcing them to run one at a time per
 * instance. Returns the locked row.
 */
export async function lockByIdTx(tx: Writer, id: string): Promise<InstanceRow | null> {
  const rows = await (tx as typeof db).select().from(instances)
    .where(eq(instances.id, id)).limit(1).for("update");
  return rows[0] ?? null;
}

/** Returns the full row including createdBy for segregation-of-duties checks. */
export async function findByIdFull(id: string, tenantId: string): Promise<InstanceRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(instances).where(eq(instances.id, id)).limit(1));
  const row = rows[0];
  if (!row || row.tenantId !== tenantId) return null;
  return row;
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<InstanceView[]> {
  const rows = await scopedRead((tx) => tx.select().from(instances)
    .where(eq(instances.tenantId, tenantId))
    .orderBy(desc(instances.updatedAt))
    .limit(limit).offset(offset));
  return rows.map(toView);
}

/** Enriched list row — the slim list view plus the subject/definition/date
 *  fields the detail view already carries (GAP-WORKFLOW-LIST-03). */
export type InstanceListRow = InstanceView & {
  definitionName: string | null;
  definitionCode: string | null;
  currentNode: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * GAP-WORKFLOW-LIST-03 — list rows carrying the subject (refType/refId),
 * definition name/code, current step and dates so the instances list can show
 * what each instance is about, where it is and how old it is (the slim
 * listByTenant projection dropped them, leaving the UI with only id/name/
 * status/version and a raw-UUID name fallback). LEFT JOIN to the same-service
 * definitions table (same module boundary already used by searchInstances).
 */
export async function listByTenantEnriched(
  tenantId: string,
  limit: number,
  offset: number,
): Promise<InstanceListRow[]> {
  const rows = await scopedExecute(sql`
    SELECT i.id, i.tenant_id, i.name, i.status, i.version,
           i.ref_type, i.ref_id, i.current_node, i.definition_id,
           i.created_at, i.updated_at,
           d.code AS definition_code, d.name AS definition_name
    FROM workflow.instances i
    LEFT JOIN workflow.definitions d ON d.id = i.definition_id
    WHERE i.tenant_id = ${tenantId}
    ORDER BY i.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `) as unknown as Array<{
    id: string; tenant_id: string; name: string; status: string; version: number;
    ref_type: string | null; ref_id: string | null; current_node: string | null;
    definition_id: string | null; created_at: Date; updated_at: Date;
    definition_code: string | null; definition_name: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    status: r.status,
    version: r.version,
    definitionId: r.definition_id,
    refType: r.ref_type,
    refId: r.ref_id,
    currentNode: r.current_node,
    definitionCode: r.definition_code,
    definitionName: r.definition_name,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  }));
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: InstanceInsert): Promise<void> {
  await tx.insert(instances).values(row);
}

export async function markCompleted(tx: Writer, id: string, actorId: string): Promise<void> {
  await tx.update(instances)
    .set({ status: "completed", updatedBy: actorId, updatedAt: new Date() })
    .where(eq(instances.id, id));
}

export async function updateCurrentNode(tx: Writer, id: string, nodeKey: string, actorId: string): Promise<void> {
  await tx.update(instances)
    .set({ currentNode: nodeKey, updatedBy: actorId, updatedAt: new Date() })
    .where(eq(instances.id, id));
}

export async function markStatus(tx: Writer, id: string, status: string, actorId: string): Promise<void> {
  await tx.update(instances)
    .set({ status, updatedBy: actorId, updatedAt: new Date() })
    .where(eq(instances.id, id));
}

/**
 * P1-4 — rebind a running instance to a different definition version (in-flight
 * migration). Optionally remaps currentNode to a node key valid in the target
 * version. Bumps version. Guarded by fromVersion so a concurrent migration /
 * advance can't clobber it.
 */
export async function rebindDefinition(
  tx: Writer,
  id: string,
  definitionId: string,
  definitionVersion: number,
  currentNode: string | null,
  actorId: string,
  fromVersion: number,
): Promise<boolean> {
  const updated = await (tx as typeof db).update(instances)
    .set({
      definitionId,
      definitionVersion,
      ...(currentNode !== null ? { currentNode } : {}),
      updatedBy: actorId,
      updatedAt: new Date(),
      version: sql`${instances.version} + 1`,
    })
    .where(and(eq(instances.id, id), eq(instances.version, fromVersion)))
    .returning({ id: instances.id });
  return updated.length > 0;
}
