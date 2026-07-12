import { eq, and, inArray, sql } from "drizzle-orm";
import { db, scopedRead} from "../../shared/db.js";
import { hrmsTrainings, hrmsNominations, type NominationRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function getNomination(tenantId: string, id: string): Promise<NominationRow | undefined> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsNominations).where(and(
    eq(hrmsNominations.id, id),
    eq(hrmsNominations.tenantId, tenantId),
  )).limit(1));
  return rows[0];
}

export async function getTraining(tenantId: string, id: string) {
  const rows = await scopedRead((tx) => tx.select().from(hrmsTrainings).where(and(
    eq(hrmsTrainings.id, id),
    eq(hrmsTrainings.tenantId, tenantId),
  )).limit(1));
  return rows[0];
}

/**
 * Record completion of a training nomination. Guarded: only an open nomination
 * (status nominated|attended) can be completed, so it is idempotent against
 * double-submits. Returns the updated row or null.
 */
export async function completeNomination(
  tx: Writer, tenantId: string, id: string, actorId: string,
  data: { completedDate: string; result: string; score: number | null; certificateRef: string | null },
): Promise<NominationRow | null> {
  const rows = await tx.update(hrmsNominations)
    .set({
      status: "completed",
      completedDate: data.completedDate,
      result: data.result,
      score: data.score,
      certificateRef: data.certificateRef,
      updatedBy: actorId,
      updatedAt: new Date(),
      version: sql`${hrmsNominations.version} + 1`,
    })
    .where(and(
      eq(hrmsNominations.id, id),
      eq(hrmsNominations.tenantId, tenantId),
      inArray(hrmsNominations.status, ["nominated", "attended"]),
    ))
    .returning();
  return rows[0] ?? null;
}

export async function insertTraining(tx: Writer, row: typeof hrmsTrainings.$inferInsert): Promise<void> {
  await tx.insert(hrmsTrainings).values(row);
}

export async function insertNomination(tx: Writer, row: typeof hrmsNominations.$inferInsert): Promise<void> {
  await tx.insert(hrmsNominations).values(row);
}

export async function listTrainingsByTenant(tenantId: string, limit = 100) {
  return scopedRead((tx) => tx.select().from(hrmsTrainings)
    .where(eq(hrmsTrainings.tenantId, tenantId))
    .limit(limit));
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
