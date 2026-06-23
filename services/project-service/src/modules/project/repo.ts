import { eq, and, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  projectProjects, projectTasks, projectMilestones,
  type ProjectRow, type ProjectInsert, type TaskInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select" | "delete">;

export async function findProjectById(id: string): Promise<ProjectRow | null> {
  const rows = await db.select().from(projectProjects).where(eq(projectProjects.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findProjectByIdTx(tx: Writer, id: string): Promise<ProjectRow | null> {
  const rows = await (tx as typeof db).select().from(projectProjects).where(eq(projectProjects.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function insertProject(tx: Writer, row: ProjectInsert): Promise<void> {
  await tx.insert(projectProjects).values(row);
}

export async function listProjects(tenantId: string, status: string | undefined, limit: number, offset: number): Promise<ProjectRow[]> {
  const base = db.select().from(projectProjects);
  if (status) {
    return base.where(and(eq(projectProjects.tenantId, tenantId), eq(projectProjects.status, status)))
      .limit(limit).offset(offset).orderBy(desc(projectProjects.createdAt));
  }
  return base.where(eq(projectProjects.tenantId, tenantId))
    .limit(limit).offset(offset).orderBy(desc(projectProjects.createdAt));
}

export async function insertTask(tx: Writer, row: TaskInsert): Promise<void> {
  await tx.insert(projectTasks).values(row);
}

export async function findTaskByIdTx(tx: Writer, id: string): Promise<typeof projectTasks.$inferSelect | null> {
  const rows = await (tx as typeof db).select().from(projectTasks).where(eq(projectTasks.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function updateTaskTx(tx: Writer, id: string, patch: Partial<TaskInsert>): Promise<void> {
  await tx.update(projectTasks).set({ ...patch, updatedAt: new Date() }).where(eq(projectTasks.id, id));
}

export async function listTasksByProject(projectId: string): Promise<(typeof projectTasks.$inferSelect)[]> {
  return db.select().from(projectTasks).where(eq(projectTasks.projectId, projectId));
}

export async function countIncompleteSubTasks(tx: Writer, parentTaskId: string): Promise<number> {
  const rows = await (tx as typeof db).select().from(projectTasks)
    .where(and(eq(projectTasks.parentTaskId, parentTaskId)));
  return rows.filter((r) => r.status !== "completed").length;
}

export async function insertMilestone(tx: Writer, row: typeof projectMilestones.$inferInsert): Promise<void> {
  await tx.insert(projectMilestones).values(row);
}

export async function findMilestoneById(id: string): Promise<typeof projectMilestones.$inferSelect | null> {
  const rows = await db.select().from(projectMilestones).where(eq(projectMilestones.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findMilestoneByIdTx(tx: Writer, id: string): Promise<typeof projectMilestones.$inferSelect | null> {
  const rows = await (tx as typeof db).select().from(projectMilestones).where(eq(projectMilestones.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function updateMilestoneTx(tx: Writer, id: string, patch: Partial<typeof projectMilestones.$inferInsert>): Promise<void> {
  await tx.update(projectMilestones).set({ ...patch, updatedAt: new Date() }).where(eq(projectMilestones.id, id));
}

export async function listMilestonesByProject(projectId: string): Promise<(typeof projectMilestones.$inferSelect)[]> {
  return db.select().from(projectMilestones).where(eq(projectMilestones.projectId, projectId));
}

export async function listMilestonesByTenant(tenantId: string, limit: number): Promise<(typeof projectMilestones.$inferSelect)[]> {
  return db.select().from(projectMilestones).where(eq(projectMilestones.tenantId, tenantId)).limit(limit);
}
