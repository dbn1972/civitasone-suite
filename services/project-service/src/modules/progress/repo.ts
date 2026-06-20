import { eq, and, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  projectPhysicalProgress, projectFinancialProgress, projectDprs,
  type PhysicalProgressInsert, type DprInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertPhysicalProgress(tx: Writer, row: PhysicalProgressInsert): Promise<void> {
  await tx.insert(projectPhysicalProgress).values(row);
}

export async function listPhysicalProgressByProject(projectId: string): Promise<(typeof projectPhysicalProgress.$inferSelect)[]> {
  return db.select().from(projectPhysicalProgress).where(eq(projectPhysicalProgress.projectId, projectId))
    .orderBy(desc(projectPhysicalProgress.periodDate));
}

export async function insertFinancialProgress(tx: Writer, row: typeof projectFinancialProgress.$inferInsert): Promise<void> {
  await tx.insert(projectFinancialProgress).values(row);
}

export async function listFinancialProgressByProject(projectId: string): Promise<(typeof projectFinancialProgress.$inferSelect)[]> {
  return db.select().from(projectFinancialProgress).where(eq(projectFinancialProgress.projectId, projectId))
    .orderBy(desc(projectFinancialProgress.periodDate));
}

export async function findDprByProjectAndDate(projectId: string, dprDate: string): Promise<(typeof projectDprs.$inferSelect) | null> {
  const rows = await db.select().from(projectDprs)
    .where(and(eq(projectDprs.projectId, projectId), eq(projectDprs.dprDate, dprDate)))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertDpr(tx: Writer, row: DprInsert): Promise<void> {
  await tx.insert(projectDprs).values(row);
}

export async function listDprsByProject(projectId: string): Promise<(typeof projectDprs.$inferSelect)[]> {
  return db.select().from(projectDprs).where(eq(projectDprs.projectId, projectId))
    .orderBy(desc(projectDprs.dprDate));
}
