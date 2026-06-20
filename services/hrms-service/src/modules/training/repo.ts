import { eq, and, inArray, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { hrmsTrainings, hrmsNominations } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertTraining(tx: Writer, row: typeof hrmsTrainings.$inferInsert): Promise<void> {
  await tx.insert(hrmsTrainings).values(row);
}

export async function insertNomination(tx: Writer, row: typeof hrmsNominations.$inferInsert): Promise<void> {
  await tx.insert(hrmsNominations).values(row);
}

export async function listTrainingsByTenant(tenantId: string, limit = 100) {
  return db.select().from(hrmsTrainings)
    .where(eq(hrmsTrainings.tenantId, tenantId))
    .limit(limit);
}

export async function countNominationsByTraining(tenantId: string, trainingIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (trainingIds.length === 0) return counts;
  const rows = await db
    .select({
      trainingId: hrmsNominations.trainingId,
      count: sql<number>`count(*)::int`,
    })
    .from(hrmsNominations)
    .where(and(eq(hrmsNominations.tenantId, tenantId), inArray(hrmsNominations.trainingId, trainingIds)))
    .groupBy(hrmsNominations.trainingId);
  for (const row of rows) counts.set(row.trainingId, row.count);
  return counts;
}
