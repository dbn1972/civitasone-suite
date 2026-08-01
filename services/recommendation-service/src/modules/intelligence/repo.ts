/**
 * intelligence/repo.ts — F.6 database operations for key-account intelligence.
 * Every query is filtered by tenant_id in addition to RLS.
 */
import { and, asc, desc, eq, gte, sql, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { toIso } from "../../shared/iso.js";
import {
  accountIntelligence,
  type AccountIntelligenceRow,
  type AccountIntelligenceInsert,
} from "./schema.js";

export function toView(r: AccountIntelligenceRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    accountId: r.accountId,
    whiteSpace: r.whiteSpace,
    riskSignals: r.riskSignals,
    /**
     * numeric(6,4) arrives as a STRING from Postgres and stays a string here.
     * Do NOT cast to `number` — precision loss on a ranked score is silent.
     */
    opportunityScore: r.opportunityScore,
    lastComputedAt: toIso(r.lastComputedAt),
    createdAt: toIso(r.createdAt),
    updatedAt: toIso(r.updatedAt),
    version: r.version,
  };
}

export type AccountIntelligenceView = ReturnType<typeof toView>;

export async function findByAccount(
  accountId: string,
  tenantId: string,
): Promise<AccountIntelligenceRow | null> {
  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(accountIntelligence)
      .where(
        and(eq(accountIntelligence.tenantId, tenantId), eq(accountIntelligence.accountId, accountId)),
      )
      .limit(1),
  );
  return rows[0] ?? null;
}

export interface RankedFilters {
  /** Decimal string, compared in numeric space by Postgres. */
  minOpportunityScore?: string;
}

export async function listRanked(
  tenantId: string,
  limit: number,
  offset: number,
  filters: RankedFilters = {},
): Promise<{ rows: AccountIntelligenceRow[]; total: number }> {
  const conditions: SQL[] = [eq(accountIntelligence.tenantId, tenantId)];
  if (filters.minOpportunityScore !== undefined) {
    conditions.push(gte(accountIntelligence.opportunityScore, filters.minOpportunityScore));
  }
  const where = and(...conditions);

  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(accountIntelligence)
      .where(where)
      // account_id is the documented stable tie-break for equal scores.
      .orderBy(desc(accountIntelligence.opportunityScore), asc(accountIntelligence.accountId))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(accountIntelligence).where(where),
  );
  const total = countResult[0]?.count ?? 0;

  return { rows, total };
}

/** Upsert on (tenant_id, account_id) — recompute replaces the live record. */
export async function upsert(
  tx: ScopedTx,
  row: AccountIntelligenceInsert,
): Promise<AccountIntelligenceRow[]> {
  return tx
    .insert(accountIntelligence)
    .values(row)
    .onConflictDoUpdate({
      target: [accountIntelligence.tenantId, accountIntelligence.accountId],
      set: {
        whiteSpace: row.whiteSpace ?? [],
        riskSignals: row.riskSignals ?? [],
        opportunityScore: row.opportunityScore ?? "0",
        lastComputedAt: row.lastComputedAt ?? new Date(),
        updatedAt: new Date(),
        updatedBy: row.updatedBy,
        version: sql`${accountIntelligence.version} + 1`,
      },
    })
    .returning();
}
