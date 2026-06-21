import { eq, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { tasks, type TaskRow, type TaskInsert, type TaskView } from "./schema.js";

export function toView(r: TaskRow): TaskView {
  return { id: r.id, tenantId: r.tenantId, instanceId: r.instanceId, name: r.name, status: r.status, version: r.version };
}

export async function findById(id: string, tenantId: string): Promise<TaskView | null> {
  const rows = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  const row = rows[0];
  if (!row || row.tenantId !== tenantId) return null;
  return toView(row);
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<TaskView[]> {
  const rows = await db.select().from(tasks)
    .where(eq(tasks.tenantId, tenantId))
    .orderBy(desc(tasks.updatedAt))
    .limit(limit)
    .offset(offset);
  return rows.map(toView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: TaskInsert): Promise<void> {
  await tx.insert(tasks).values(row);
}

export async function markCompleted(tx: Writer, id: string, tenantId: string, actorId: string): Promise<TaskView | null> {
  const existing = await findById(id, tenantId);
  if (!existing || existing.status === "completed") return null;
  await tx.update(tasks).set({ status: "completed", updatedBy: actorId, updatedAt: new Date(), version: existing.version + 1 }).where(eq(tasks.id, id));
  return { ...existing, status: "completed", version: existing.version + 1 };
}
