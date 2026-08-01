/**
 * health/scoring-repo.ts — KA-004 reads for the banded health surface.
 *
 * A separate file from repo.ts so the existing health endpoints and their tests
 * keep their exact module contract.
 *
 * health_scores is append-only (one row per recompute), so "current health" means
 * the newest row per account. That is expressed as DISTINCT ON (account_id)
 * inside a subquery, and the band filter + LIMIT are applied by Postgres — the
 * watchlist must never pull every account into the service to filter in JS.
 */
import { and, asc, eq, lte, sql } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { healthScores } from "./schema.js";

export interface LatestHealthRow {
  id: string;
  accountId: string;
  score: number;
  factors: Record<string, unknown>;
  computedAt: Date;
  version: number;
}

/** Newest health row per account for this tenant, as a named subquery. */
function latestPerAccount(tx: ScopedTx, tenantId: string) {
  return tx
    .selectDistinctOn([healthScores.accountId], {
      id: healthScores.id,
      accountId: healthScores.accountId,
      score: healthScores.score,
      factors: healthScores.factors,
      computedAt: healthScores.computedAt,
      version: healthScores.version,
    })
    .from(healthScores)
    .where(eq(healthScores.tenantId, tenantId))
    // DISTINCT ON requires the leading ORDER BY term to be the distinct key.
    .orderBy(asc(healthScores.accountId), sql`${healthScores.computedAt} DESC`)
    .as("latest_health");
}

/**
 * Accounts whose current score is at or below `maxScore` (the at_risk band
 * ceiling), worst first. `limit` is applied in SQL.
 */
export async function listAtRisk(
  tenantId: string,
  maxScore: number,
  limit: number,
): Promise<{ rows: LatestHealthRow[]; total: number }> {
  const rows = await scopedRead(async (tx) => {
    const latest = latestPerAccount(tx, tenantId);
    return tx
      .select()
      .from(latest)
      .where(lte(latest.score, maxScore))
      // score ASC = worst first; account_id is the stable tie-break.
      .orderBy(asc(latest.score), asc(latest.accountId))
      .limit(limit);
  });

  const countResult = await scopedRead(async (tx) => {
    const latest = latestPerAccount(tx, tenantId);
    return tx
      .select({ count: sql<number>`count(*)::int` })
      .from(latest)
      .where(lte(latest.score, maxScore));
  });

  return { rows, total: countResult[0]?.count ?? 0 };
}

/**
 * Current health row for one account, or null when it has never been scored.
 * Duplicates the intent of repo.findLatestByAccount but returns only the columns
 * the breakdown endpoint needs.
 */
export async function findCurrent(tenantId: string, accountId: string): Promise<LatestHealthRow | null> {
  const rows = await scopedRead((tx) =>
    tx
      .select({
        id: healthScores.id,
        accountId: healthScores.accountId,
        score: healthScores.score,
        factors: healthScores.factors,
        computedAt: healthScores.computedAt,
        version: healthScores.version,
      })
      .from(healthScores)
      .where(and(eq(healthScores.tenantId, tenantId), eq(healthScores.accountId, accountId)))
      .orderBy(sql`${healthScores.computedAt} DESC`)
      .limit(1),
  );
  return rows[0] ?? null;
}
