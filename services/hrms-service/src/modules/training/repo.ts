import { eq, and, inArray, sql } from "drizzle-orm";
import { db, scopedRead} from "../../shared/db.js";
import { hrmsTrainings, hrmsNominations, type NominationRow } from "./schema.js";
import { trainingSessions } from "../training-admin/schema.js";

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
  const rows = await scopedRead((tx) => tx
    .select({
      trainingId: hrmsNominations.trainingId,
      count: sql<number>`count(*)::int`,
    })
    .from(hrmsNominations)
    .where(and(eq(hrmsNominations.tenantId, tenantId), inArray(hrmsNominations.trainingId, trainingIds)))
    .groupBy(hrmsNominations.trainingId));
  for (const row of rows) counts.set(row.trainingId, row.count);
  return counts;
}


/**
 * SVC-121/122 -- a single employee's training nominations for the caller tenant,
 * with the linked training and (optional) session. Read inside scopedRead so the
 * tenant GUC is set and RLS enforces isolation (not merely the WHERE clause).
 */
export interface EmployeeNominationRow {
  id: string;
  status: string;
  trainingId: string;
  trainingTitle: string | null;
  trainingFromDate: string | null;
  trainingToDate: string | null;
  trainingVenue: string | null;
  sessionId: string | null;
  sessionTitle: string | null;
  sessionDate: string | null;
  waitlistPosition: number | null;
  result: string | null;
  score: number | null;
  completedDate: string | null;
  createdAt: Date;
}

export async function listNominationsByEmployee(
  tenantId: string, employeeId: string, limit = 100,
): Promise<EmployeeNominationRow[]> {
  return scopedRead((tx) => tx
    .select({
      id: hrmsNominations.id,
      status: hrmsNominations.status,
      trainingId: hrmsNominations.trainingId,
      trainingTitle: hrmsTrainings.title,
      trainingFromDate: hrmsTrainings.fromDate,
      trainingToDate: hrmsTrainings.toDate,
      trainingVenue: hrmsTrainings.venue,
      sessionId: hrmsNominations.sessionId,
      sessionTitle: trainingSessions.title,
      sessionDate: trainingSessions.sessionDate,
      waitlistPosition: hrmsNominations.waitlistPosition,
      result: hrmsNominations.result,
      score: hrmsNominations.score,
      completedDate: hrmsNominations.completedDate,
      createdAt: hrmsNominations.createdAt,
    })
    .from(hrmsNominations)
    .leftJoin(hrmsTrainings, eq(hrmsTrainings.id, hrmsNominations.trainingId))
    .leftJoin(trainingSessions, eq(trainingSessions.id, hrmsNominations.sessionId))
    .where(and(
      eq(hrmsNominations.tenantId, tenantId),
      eq(hrmsNominations.employeeId, employeeId),
    ))
    .limit(limit)) as Promise<EmployeeNominationRow[]>;
}
