import { eq, and } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead } from "../../shared/db.js";
import { sql } from "drizzle-orm";
import { grantApplications, grantScores, grantSanctionCounters, type ApplicationRow, type ApplicationInsert, type ScoreRow, type ScoreInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findApplicationById(id: string, tenantId: string): Promise<ApplicationRow | null> {
  return runWithTenant(tenantId, () => db.transaction(async (tx) => {
    const rows = await tx.select().from(grantApplications)
      .where(and(eq(grantApplications.id, id), eq(grantApplications.tenantId, tenantId))).limit(1);
    return rows[0] ?? null;
  }));
}

export async function findApplicationByIdTx(tx: Writer, id: string, tenantId: string): Promise<ApplicationRow | null> {
  const rows = await (tx as typeof db).select().from(grantApplications)
    .where(and(eq(grantApplications.id, id), eq(grantApplications.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

/**
 * M1 FIX: Locked read for disbursement guard — SELECT FOR UPDATE prevents
 * concurrent disbursements from both passing the sum check before either inserts.
 */
export async function findApplicationByIdForUpdate(tx: Writer, id: string, tenantId: string): Promise<ApplicationRow | null> {
  const rows = await (tx as typeof db).execute(
    sql`SELECT * FROM ${grantApplications} WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1 FOR UPDATE`,
  ) as unknown as ApplicationRow[];
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

export async function findScoreByApplicationAndReviewer(applicationId: string, reviewerRef: string, tenantId: string): Promise<ScoreRow | null> {
  return runWithTenant(tenantId, () => db.transaction(async (tx) => {
    const rows = await tx.select().from(grantScores)
      .where(and(eq(grantScores.applicationId, applicationId), eq(grantScores.reviewerRef, reviewerRef)))
      .limit(1);
    return rows[0] ?? null;
  }));
}

export async function listApplicationsByTenant(tenantId: string, limit: number): Promise<ApplicationRow[]> {
  return runWithTenant(tenantId, () => scopedRead(async (tx) =>
    tx.select().from(grantApplications)
      .where(eq(grantApplications.tenantId, tenantId))
      .limit(limit)));
}

/**
 * Gapless per-(tenant, FY) sanction number allocation. Runs INSIDE the consumer
 * transaction: the atomic upsert below either seeds the counter (returning 1) or
 * increments it and returns the value just consumed. Because it shares the caller
 * transaction, a rolled-back insert releases the number — no gaps, no collisions.
 * Returns a formatted sanction number e.g. GNT-2025-26-00001.
 */
export async function allocateSanctionNo(tx: Writer, tenantId: string, fy: string): Promise<string> {
  const rows = await (tx as typeof db)
    .insert(grantSanctionCounters)
    .values({ tenantId, fy, nextVal: 2n })
    .onConflictDoUpdate({
      target: [grantSanctionCounters.tenantId, grantSanctionCounters.fy],
      set: { nextVal: sql`${grantSanctionCounters.nextVal} + 1` },
    })
    .returning({ nextVal: grantSanctionCounters.nextVal });
  // On insert, nextVal in DB is the seeded 2, allocated number is 1.
  // On update, RETURNING gives the post-increment value; allocated number is that minus 1.
  const stored = rows[0]!.nextVal;
  const allocated = stored - 1n;
  const seq = allocated.toString().padStart(5, "0");
  return `GNT-${fy}-${seq}`;
}
