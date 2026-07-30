import { eq, and, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsCandidates, hrmsCandidateOtpChallenges, type OtpChallengeRow } from "./candidate-schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

function affected(res: unknown): number {
  const r = res as { rowCount?: number; count?: number };
  return r.rowCount ?? r.count ?? 0;
}

export async function insertChallenge(tx: Writer, row: typeof hrmsCandidateOtpChallenges.$inferInsert): Promise<void> {
  await tx.insert(hrmsCandidateOtpChallenges).values(row);
}

/** The latest challenge for a candidate+channel (may be expired/verified). */
export async function findLatestChallenge(tenantId: string, candidateId: string, channel: string): Promise<OtpChallengeRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsCandidateOtpChallenges)
    .where(and(
      eq(hrmsCandidateOtpChallenges.tenantId, tenantId),
      eq(hrmsCandidateOtpChallenges.candidateId, candidateId),
      eq(hrmsCandidateOtpChallenges.channel, channel),
    ))
    .orderBy(desc(hrmsCandidateOtpChallenges.createdAt)).limit(1));
  return rows[0] ?? null;
}

/** Increment attempts. */
export async function incrementAttempts(tx: Writer, tenantId: string, id: string): Promise<void> {
  await tx.update(hrmsCandidateOtpChallenges)
    .set({ attempts: (await tx.select({ a: hrmsCandidateOtpChallenges.attempts }).from(hrmsCandidateOtpChallenges).where(eq(hrmsCandidateOtpChallenges.id, id)))[0]!.a + 1 })
    .where(and(eq(hrmsCandidateOtpChallenges.tenantId, tenantId), eq(hrmsCandidateOtpChallenges.id, id)));
}

/** Mark as verified + update candidate.emailVerified/mobileVerified. */
export async function markVerified(tx: Writer, tenantId: string, id: string, candidateId: string, channel: string): Promise<void> {
  await tx.update(hrmsCandidateOtpChallenges).set({ verified: true })
    .where(and(eq(hrmsCandidateOtpChallenges.tenantId, tenantId), eq(hrmsCandidateOtpChallenges.id, id)));
  const patch: Record<string, unknown> = channel === "email" ? { emailVerified: true } : { mobileVerified: true };
  await tx.update(hrmsCandidates).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(hrmsCandidates.tenantId, tenantId), eq(hrmsCandidates.id, candidateId)));
}
