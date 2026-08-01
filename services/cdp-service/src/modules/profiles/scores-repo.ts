/**
 * profiles/scores-repo.ts — CDP-009 predictive scores on a golden profile.
 */
import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { profileScores, type ProfileScoreRow } from "./schema.js";

/**
 * `score` stays a STRING all the way out to JSON. postgres-js returns numeric as text to
 * preserve the exact stored value; parsing it into a JS number would reintroduce the
 * binary-float rounding the numeric column exists to avoid, and a client comparing
 * against a threshold would silently disagree with the database.
 */
export function toView(r: ProfileScoreRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    profileId: r.profileId,
    scoreType: r.scoreType,
    score: r.score,
    modelVersion: r.modelVersion,
    computedAt: r.computedAt.toISOString(),
    version: r.version,
  };
}

export type ScoreView = ReturnType<typeof toView>;

export async function findByType(
  profileId: string,
  tenantId: string,
  scoreType: string,
): Promise<ProfileScoreRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(profileScores)
      .where(and(
        eq(profileScores.profileId, profileId),
        eq(profileScores.tenantId, tenantId),
        eq(profileScores.scoreType, scoreType),
      ))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listByProfile(
  profileId: string,
  tenantId: string,
  limit: number,
  offset: number,
): Promise<{ rows: ProfileScoreRow[]; total: number }> {
  const where = and(eq(profileScores.profileId, profileId), eq(profileScores.tenantId, tenantId));

  const rows = await scopedRead((tx) =>
    tx.select().from(profileScores)
      .where(where)
      .orderBy(desc(profileScores.computedAt))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(profileScores).where(where),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insert(
  tx: ScopedTx,
  row: {
    id: string;
    tenantId: string;
    profileId: string;
    scoreType: string;
    score: string;
    modelVersion: string;
    computedAt: Date;
  },
): Promise<void> {
  await tx.insert(profileScores).values(row);
}

/**
 * Replace an existing score under optimistic locking. ml-service retrains on a schedule,
 * so two runs can land together; the version check makes the loser retry against the
 * fresh row instead of overwriting a newer model's output.
 */
export async function updateScore(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  currentVersion: number,
  patch: { score: string; modelVersion: string; computedAt: Date },
): Promise<boolean> {
  const result = await tx
    .update(profileScores)
    .set({ ...patch, version: sql`${profileScores.version} + 1` })
    .where(and(
      eq(profileScores.id, id),
      eq(profileScores.tenantId, tenantId),
      eq(profileScores.version, currentVersion),
    ))
    .returning({ id: profileScores.id });
  return result.length > 0;
}

export async function countByProfile(profileId: string, tenantId: string): Promise<number> {
  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(profileScores)
      .where(and(eq(profileScores.profileId, profileId), eq(profileScores.tenantId, tenantId))),
  );
  return countResult[0]?.count ?? 0;
}
