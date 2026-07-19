import { eq, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { adminBackupSchedules, adminBackupRuns, type AdminBackupRunInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function upsertSchedule(tx: Writer, tenantId: string, cronExpr: string, actorId: string): Promise<string> {
  const existing = await tx.select().from(adminBackupSchedules).where(eq(adminBackupSchedules.tenantId, tenantId)).limit(1);
  if (existing[0]) {
    await tx.update(adminBackupSchedules).set({ cronExpr, updatedBy: actorId, updatedAt: new Date() })
      .where(eq(adminBackupSchedules.id, existing[0].id));
    return existing[0].id;
  }
  const inserted = await tx.insert(adminBackupSchedules).values({
    tenantId, cronExpr, createdBy: actorId, updatedBy: actorId,
  }).returning();
  return inserted[0]!.id;
}

export async function insertRun(tx: Writer, row: AdminBackupRunInsert): Promise<void> {
  await tx.insert(adminBackupRuns).values(row);
}

export async function listRuns(tenantId: string) {
  return scopedRead((tx) => tx.select().from(adminBackupRuns).where(eq(adminBackupRuns.tenantId, tenantId))
    .orderBy(desc(adminBackupRuns.startedAt)).limit(50));
}
