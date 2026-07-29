import { eq, and, desc, sql, type SQL } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import {
  hrmsAssessmentBlueprints, hrmsAssessmentQuestions, hrmsAssessmentEvents,
  type BlueprintRow, type BlueprintInsert, type QuestionRow, type QuestionInsert, type AssessmentEventRow,
} from "./blueprint-schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// ---- blueprints ---------------------------------------------------------

export async function insertBlueprint(tx: Writer, row: BlueprintInsert): Promise<void> {
  await tx.insert(hrmsAssessmentBlueprints).values(row);
}

export async function findBlueprint(tenantId: string, id: string): Promise<BlueprintRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsAssessmentBlueprints)
    .where(and(eq(hrmsAssessmentBlueprints.tenantId, tenantId), eq(hrmsAssessmentBlueprints.id, id))).limit(1));
  return rows[0] ?? null;
}

export async function updateBlueprint(
  tx: Writer, tenantId: string, id: string, patch: Partial<BlueprintInsert>, expectedVersion: number,
): Promise<void> {
  const res = await tx.update(hrmsAssessmentBlueprints)
    .set({ ...patch, version: sql`${hrmsAssessmentBlueprints.version} + 1`, updatedAt: new Date() })
    .where(and(
      eq(hrmsAssessmentBlueprints.tenantId, tenantId),
      eq(hrmsAssessmentBlueprints.id, id),
      eq(hrmsAssessmentBlueprints.version, expectedVersion),
    ));
  if ((res as { rowCount?: number }).rowCount === 0) {
    throw new HttpError(409, "VERSION_CONFLICT", "blueprint was modified by another request; reload and retry");
  }
}

export async function listBlueprints(
  tenantId: string, filter: { status?: string }, limit: number,
): Promise<BlueprintRow[]> {
  const conds: SQL[] = [eq(hrmsAssessmentBlueprints.tenantId, tenantId)];
  if (filter.status) conds.push(eq(hrmsAssessmentBlueprints.status, filter.status));
  return scopedRead((tx) => tx.select().from(hrmsAssessmentBlueprints)
    .where(and(...conds)).orderBy(desc(hrmsAssessmentBlueprints.createdAt)).limit(limit));
}

// ---- questions ----------------------------------------------------------

export async function insertQuestion(tx: Writer, row: QuestionInsert): Promise<void> {
  await tx.insert(hrmsAssessmentQuestions).values(row);
}

export async function findQuestion(tenantId: string, id: string): Promise<QuestionRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsAssessmentQuestions)
    .where(and(eq(hrmsAssessmentQuestions.tenantId, tenantId), eq(hrmsAssessmentQuestions.id, id))).limit(1));
  return rows[0] ?? null;
}

export async function updateQuestion(
  tx: Writer, tenantId: string, id: string, patch: Partial<QuestionInsert>, expectedVersion: number,
): Promise<void> {
  const res = await tx.update(hrmsAssessmentQuestions)
    .set({ ...patch, version: sql`${hrmsAssessmentQuestions.version} + 1`, updatedAt: new Date() })
    .where(and(
      eq(hrmsAssessmentQuestions.tenantId, tenantId),
      eq(hrmsAssessmentQuestions.id, id),
      eq(hrmsAssessmentQuestions.version, expectedVersion),
    ));
  if ((res as { rowCount?: number }).rowCount === 0) {
    throw new HttpError(409, "VERSION_CONFLICT", "question was modified by another request; reload and retry");
  }
}

export async function listQuestions(
  tenantId: string,
  filter: { topic?: string; qtype?: string; difficulty?: string; status?: string },
  limit: number,
): Promise<QuestionRow[]> {
  const conds: SQL[] = [eq(hrmsAssessmentQuestions.tenantId, tenantId)];
  if (filter.topic) conds.push(eq(hrmsAssessmentQuestions.topic, filter.topic));
  if (filter.qtype) conds.push(eq(hrmsAssessmentQuestions.qtype, filter.qtype));
  if (filter.difficulty) conds.push(eq(hrmsAssessmentQuestions.difficulty, filter.difficulty));
  if (filter.status) conds.push(eq(hrmsAssessmentQuestions.status, filter.status));
  return scopedRead((tx) => tx.select().from(hrmsAssessmentQuestions)
    .where(and(...conds)).orderBy(desc(hrmsAssessmentQuestions.createdAt)).limit(limit));
}

// ---- audit --------------------------------------------------------------

export async function insertEvent(
  tx: Writer,
  ev: { tenantId: string; entityType: "blueprint" | "question"; entityId: string; action: string; detail?: unknown; actorId: string },
): Promise<void> {
  await tx.insert(hrmsAssessmentEvents).values({
    tenantId: ev.tenantId, entityType: ev.entityType, entityId: ev.entityId,
    action: ev.action, detail: (ev.detail ?? {}) as never, actorId: ev.actorId,
  });
}

export async function listEvents(tenantId: string, entityType: string, entityId: string): Promise<AssessmentEventRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsAssessmentEvents)
    .where(and(
      eq(hrmsAssessmentEvents.tenantId, tenantId),
      eq(hrmsAssessmentEvents.entityType, entityType),
      eq(hrmsAssessmentEvents.entityId, entityId),
    )).orderBy(desc(hrmsAssessmentEvents.createdAt)));
}
