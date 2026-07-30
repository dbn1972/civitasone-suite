import { eq, and, or, desc, sql, type SQL } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import {
  hrmsCandidates, hrmsCandidateEducation, hrmsCandidateEmployment,
  type CandidateRow, type CandidateInsert, type EducationRow, type EmploymentRow,
} from "./candidate-schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertCandidate(tx: Writer, row: CandidateInsert): Promise<void> {
  await tx.insert(hrmsCandidates).values(row);
}

export async function findCandidate(tenantId: string, id: string): Promise<CandidateRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsCandidates)
    .where(and(eq(hrmsCandidates.tenantId, tenantId), eq(hrmsCandidates.id, id))).limit(1));
  return rows[0] ?? null;
}

/** Active (non-withdrawn) candidates matching any of the identity keys. */
export async function findDuplicates(
  tenantId: string, keys: { normalizedEmail?: string; normalizedMobile?: string; resumeFingerprint?: string },
): Promise<Array<{ id: string; matchedOn: string }>> {
  const ors: SQL[] = [];
  if (keys.normalizedEmail) ors.push(eq(hrmsCandidates.normalizedEmail, keys.normalizedEmail));
  if (keys.normalizedMobile) ors.push(eq(hrmsCandidates.normalizedMobile, keys.normalizedMobile));
  if (keys.resumeFingerprint) ors.push(eq(hrmsCandidates.resumeFingerprint, keys.resumeFingerprint));
  if (ors.length === 0) return [];
  const rows = await scopedRead((tx) => tx
    .select({ id: hrmsCandidates.id, email: hrmsCandidates.normalizedEmail, mobile: hrmsCandidates.normalizedMobile, fp: hrmsCandidates.resumeFingerprint })
    .from(hrmsCandidates)
    .where(and(eq(hrmsCandidates.tenantId, tenantId), sql`${hrmsCandidates.status} <> 'withdrawn'`, or(...ors)!)));
  return rows.map((r) => ({
    id: r.id,
    matchedOn: r.email === keys.normalizedEmail ? "email" : r.mobile === keys.normalizedMobile ? "mobile" : "resume_fingerprint",
  }));
}

export async function updateCandidate(
  tx: Writer, tenantId: string, id: string, patch: Partial<CandidateInsert>, expectedVersion: number,
): Promise<void> {
  const res = await tx.update(hrmsCandidates)
    .set({ ...patch, version: sql`${hrmsCandidates.version} + 1`, updatedAt: new Date() })
    .where(and(eq(hrmsCandidates.tenantId, tenantId), eq(hrmsCandidates.id, id), eq(hrmsCandidates.version, expectedVersion)));
  if (((res as { rowCount?: number; count?: number }).rowCount ?? (res as { count?: number }).count ?? 0) === 0) {
    throw new HttpError(409, "VERSION_CONFLICT", "candidate was modified by another request; reload and retry");
  }
}

export async function insertEducation(tx: Writer, row: typeof hrmsCandidateEducation.$inferInsert): Promise<void> {
  await tx.insert(hrmsCandidateEducation).values(row);
}
export async function insertEmployment(tx: Writer, row: typeof hrmsCandidateEmployment.$inferInsert): Promise<void> {
  await tx.insert(hrmsCandidateEmployment).values(row);
}
export async function listEducation(tenantId: string, candidateId: string): Promise<EducationRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsCandidateEducation)
    .where(and(eq(hrmsCandidateEducation.tenantId, tenantId), eq(hrmsCandidateEducation.candidateId, candidateId)))
    .orderBy(desc(hrmsCandidateEducation.yearOfPassing)));
}
export async function listEmployment(tenantId: string, candidateId: string): Promise<EmploymentRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsCandidateEmployment)
    .where(and(eq(hrmsCandidateEmployment.tenantId, tenantId), eq(hrmsCandidateEmployment.candidateId, candidateId)))
    .orderBy(desc(hrmsCandidateEmployment.fromDate)));
}
export async function countEducation(tenantId: string, candidateId: string): Promise<number> {
  const rows = await scopedRead((tx) => tx.select({ n: sql<string>`count(*)` }).from(hrmsCandidateEducation)
    .where(and(eq(hrmsCandidateEducation.tenantId, tenantId), eq(hrmsCandidateEducation.candidateId, candidateId))));
  return Number(rows[0]?.n ?? "0");
}
export async function countEmployment(tenantId: string, candidateId: string): Promise<number> {
  const rows = await scopedRead((tx) => tx.select({ n: sql<string>`count(*)` }).from(hrmsCandidateEmployment)
    .where(and(eq(hrmsCandidateEmployment.tenantId, tenantId), eq(hrmsCandidateEmployment.candidateId, candidateId))));
  return Number(rows[0]?.n ?? "0");
}
