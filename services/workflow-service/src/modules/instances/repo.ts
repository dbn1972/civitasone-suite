import { eq, desc, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
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
  const rows = await db.select().from(instances).where(eq(instances.id, id)).limit(1);
  const row = rows[0];
  if (!row || row.tenantId !== tenantId) return null;
  return toView(row);
}

export async function findByIdTx(tx: Writer, id: string): Promise<InstanceRow | null> {
  const rows = await (tx as typeof db).select().from(instances).where(eq(instances.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Returns the full row including createdBy for segregation-of-duties checks. */
export async function findByIdFull(id: string, tenantId: string): Promise<InstanceRow | null> {
  const rows = await db.select().from(instances).where(eq(instances.id, id)).limit(1);
  const row = rows[0];
  if (!row || row.tenantId !== tenantId) return null;
  return row;
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<InstanceView[]> {
  const rows = await db.select().from(instances)
    .where(eq(instances.tenantId, tenantId))
    .orderBy(desc(instances.updatedAt))
    .limit(limit).offset(offset);
  return rows.map(toView);
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
