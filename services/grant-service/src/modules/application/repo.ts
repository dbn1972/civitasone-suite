import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { grantApplications, grantScores, type ApplicationRow, type ApplicationInsert, type ScoreRow, type ScoreInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findApplicationById(id: string): Promise<ApplicationRow | null> {
  const rows = await db.select().from(grantApplications).where(eq(grantApplications.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findApplicationByIdTx(tx: Writer, id: string): Promise<ApplicationRow | null> {
  const rows = await (tx as typeof db).select().from(grantApplications).where(eq(grantApplications.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function insertApplication(tx: Writer, row: ApplicationInsert): Promise<void> {
  await tx.insert(grantApplications).values(row);
}

export async function updateApplication(tx: Writer, id: string, patch: Partial<ApplicationInsert>): Promise<void> {
  await tx.update(grantApplications).set({ ...patch, updatedAt: new Date() }).where(eq(grantApplications.id, id));
}

export async function insertScore(tx: Writer, row: ScoreInsert): Promise<void> {
  await tx.insert(grantScores).values(row);
}

export async function findScoreByApplicationAndReviewer(applicationId: string, reviewerRef: string): Promise<ScoreRow | null> {
  const rows = await db.select().from(grantScores)
    .where(and(eq(grantScores.applicationId, applicationId), eq(grantScores.reviewerRef, reviewerRef)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listApplicationsByTenant(tenantId: string, limit: number): Promise<ApplicationRow[]> {
  return db.select().from(grantApplications)
    .where(eq(grantApplications.tenantId, tenantId))
    .limit(limit);
}
