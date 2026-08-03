import { eq, and, gte, lte, desc, sql, type SQL } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  interactionSentiments,
  type InteractionSentimentRow,
  type InteractionSentimentInsert,
  type InteractionSentimentView,
} from "./schema.js";

export function toView(r: InteractionSentimentRow): InteractionSentimentView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    activityId: r.activityId,
    activityType: r.activityType,
    contactId: r.contactId,
    dealId: r.dealId,
    polarity: r.polarity,
    score: r.score,
    themes: r.themes ?? [],
    excerpt: r.excerpt,
    model: r.model,
    analysedAt: r.analysedAt.toISOString(),
    version: r.version,
  };
}

export interface ListFilters {
  from?: Date | undefined;
  to?: Date | undefined;
  polarity?: string | undefined;
  activityType?: string | undefined;
}

function conditions(tenantId: string, f: ListFilters): SQL[] {
  const where: SQL[] = [eq(interactionSentiments.tenantId, tenantId)];
  if (f.from) where.push(gte(interactionSentiments.analysedAt, f.from));
  if (f.to) where.push(lte(interactionSentiments.analysedAt, f.to));
  if (f.polarity) where.push(eq(interactionSentiments.polarity, f.polarity));
  if (f.activityType)
    where.push(eq(interactionSentiments.activityType, f.activityType));
  return where;
}

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
  filters: ListFilters = {},
): Promise<{ rows: InteractionSentimentView[]; total: number }> {
  return scopedRead(async (tx) => {
    const where = and(...conditions(tenantId, filters));
    const rows = await tx
      .select()
      .from(interactionSentiments)
      .where(where)
      .orderBy(desc(interactionSentiments.analysedAt))
      .limit(limit)
      .offset(offset);
    const counted = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(interactionSentiments)
      .where(where);
    return { rows: rows.map(toView), total: counted[0]?.count ?? 0 };
  });
}

/**
 * Rows feeding the VoC aggregate, newest first and capped. The summary is a trend
 * read, and an unbounded scan would degrade as a tenant's history grows — so it
 * reads the most recent `cap` readings and reports whether it hit that ceiling.
 */
export async function listForSummary(
  tenantId: string,
  filters: ListFilters,
  cap: number,
): Promise<{ polarity: string; score: number; themes: string[] }[]> {
  const rows = await scopedRead((tx) =>
    tx
      .select({
        polarity: interactionSentiments.polarity,
        score: interactionSentiments.score,
        themes: interactionSentiments.themes,
      })
      .from(interactionSentiments)
      .where(and(...conditions(tenantId, filters)))
      .orderBy(desc(interactionSentiments.analysedAt))
      .limit(cap),
  );
  return rows.map((r) => ({
    polarity: r.polarity,
    score: r.score,
    themes: r.themes ?? [],
  }));
}

export type Writer = Pick<typeof db, "insert" | "update" | "delete" | "select">;

/**
 * Insert a reading, ignoring a repeat for the same activity. The unique index on
 * (tenant_id, activity_id) plus this clause are what make analysis idempotent: a
 * redelivered command cannot double-count an interaction in the aggregate.
 */
export async function insertIgnoringDuplicate(
  tx: Writer,
  row: InteractionSentimentInsert,
): Promise<void> {
  await tx
    .insert(interactionSentiments)
    .values(row)
    .onConflictDoNothing({
      target: [
        interactionSentiments.tenantId,
        interactionSentiments.activityId,
      ],
    });
}
