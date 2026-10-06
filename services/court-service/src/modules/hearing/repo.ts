import { eq, and, desc, gte, lte, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { hearings } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
export type HearingRow    = typeof hearings.$inferSelect;
export type HearingInsert = typeof hearings.$inferInsert;

export async function insertHearing(tx: Writer, row: HearingInsert): Promise<void> {
  // Idempotent on the deterministic id: a redelivery with the same id is a no-op.
  await tx.insert(hearings).values(row).onConflictDoNothing({ target: hearings.id });
}

export async function getHearingForUpdate(
  tx: Writer, tenantId: string, id: string,
): Promise<{ status: string; version: number; caseId: string } | undefined> {
  // caseId is included alongside status/version (DOM-003) so a caller that
  // needs to verify hearing OWNERSHIP -- e.g. order/consumer.ts's recordOrder,
  // confirming a cited hearingId genuinely belongs to the case an order is
  // being recorded against -- doesn't need a second query.
  const rows = await tx.select({ status: hearings.status, version: hearings.version, caseId: hearings.caseId })
    .from(hearings)
    .where(and(eq(hearings.tenantId, tenantId), eq(hearings.id, id)))
    .limit(1);
  return rows[0];
}

export async function listHearingsByCase(tenantId: string, caseId: string): Promise<HearingRow[]> {
  return scopedRead((tx) => tx.select().from(hearings)
    .where(and(eq(hearings.tenantId, tenantId), eq(hearings.caseId, caseId)))
    .orderBy(desc(hearings.scheduledDate)));
}

/**
 * GAP-COURT-HEARINGS-03: a flat, tenant-scoped hearings read model with a
 * scheduled-date range [from,to] (YYYY-MM-DD, inclusive, compared on the IST
 * calendar day of the scheduled instant), optional status and benchId filters,
 * and paging. Powers the "today's hearings" day view that could not be built
 * while hearings were only reachable per-case. Tenant predicate always applied
 * (defence in depth alongside RLS); never a cross-court leak.
 */
export async function listHearings(
  filters: { tenantId: string; from?: string | undefined; to?: string | undefined; status?: string | undefined; benchId?: string | undefined },
  limit: number,
  offset: number,
): Promise<HearingRow[]> {
  const predicates = hearingRangePredicates(filters);
  return scopedRead((tx) => tx.select().from(hearings)
    .where(and(...predicates))
    .orderBy(desc(hearings.scheduledDate))
    .limit(limit)
    .offset(offset));
}

export async function countHearings(
  filters: { tenantId: string; from?: string | undefined; to?: string | undefined; status?: string | undefined; benchId?: string | undefined },
): Promise<number> {
  const predicates = hearingRangePredicates(filters);
  const rows = await scopedRead<{ count: number }[]>((tx) => tx
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(hearings)
    .where(and(...predicates)));
  return rows[0]?.count ?? 0;
}

function hearingRangePredicates(filters: {
  tenantId: string; from?: string | undefined; to?: string | undefined; status?: string | undefined; benchId?: string | undefined;
}) {
  const predicates = [eq(hearings.tenantId, filters.tenantId)];
  // Compare on the IST calendar day of the scheduled instant so a range like
  // {from: today, to: today} captures the whole IST day regardless of the
  // stored UTC time.
  if (filters.from) predicates.push(gte(sql`(${hearings.scheduledDate} at time zone 'Asia/Kolkata')::date`, filters.from));
  if (filters.to) predicates.push(lte(sql`(${hearings.scheduledDate} at time zone 'Asia/Kolkata')::date`, filters.to));
  if (filters.status) predicates.push(eq(hearings.status, filters.status));
  if (filters.benchId) predicates.push(eq(hearings.benchId, filters.benchId));
  return predicates;
}

/** Single-row read for a synchronous pre-check before publishing an adjourn/
 *  outcome command (mirrors what the consumer reads inside its own tx, so the
 *  route can reject a foreseeable illegal transition immediately instead of
 *  the caller getting a 202 that silently dead-letters). Not cached -- this
 *  module does not use the read-through cache anywhere else either. */
export async function getHearingById(tenantId: string, id: string): Promise<HearingRow | undefined> {
  const rows = await scopedRead<HearingRow[]>((tx) => tx.select().from(hearings)
    .where(and(eq(hearings.tenantId, tenantId), eq(hearings.id, id)))
    .limit(1));
  return rows[0];
}
